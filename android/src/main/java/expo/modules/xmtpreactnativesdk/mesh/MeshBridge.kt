package expo.modules.xmtpreactnativesdk.mesh

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.CodedException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.xmtp.android.library.Client
import org.xmtp.android.library.hexToByteArray
import org.xmtp.android.library.mesh.Mesh
import org.xmtp.android.library.mesh.MeshNodeFiles
import org.xmtp.android.library.mesh.MeshOptions
import org.xmtp.android.library.mesh.MeshRadio
import org.xmtp.android.library.mesh.policy.MeshPermissions
import java.io.File

/**
 * XMTPModule's handle on the Android mesh radio (org.xmtp.android.library.mesh.Mesh).
 * Pushes presence, radio and Bluetooth changes to JS as JSON-string events
 * (src/lib/meshCodec.ts parses them).
 *
 * [MeshNodeFiles] is not thread-safe against a concurrent rotate or against a concurrent
 * [Mesh.start]/[Mesh.stop] (see MeshNodeFiles.kt's own doc comment). [Mesh]'s own lock that
 * serializes its start/stop is private to that object, so this bridge keeps its own lock and
 * every method that starts, stops or rotates the node database takes it.
 *
 * [stop] (a standalone radio stop) and a node rotation must never be composed as two separate
 * lock acquisitions: `stop()` followed later by a rotate — even from the same coroutine, even
 * back-to-back — leaves a window where a concurrent [start] can reopen the pre-rotation
 * generation, and the rotate then deletes the files out from under that freshly-opened node
 * (Task 6 review, Ruling 6). [stopAndRotate] closes that window by holding this bridge's lock
 * for the whole stop → [between] → rotate sequence in one acquisition; [resetNode] and
 * `deleteLocalDatabase`'s mesh branch (XMTPModule.kt) use it instead of calling [stop] and a
 * rotate as two separate calls. Do not call back into this MeshBridge (`start`, `stop`,
 * `resetNode`, `stopAndRotate`) from [between]: this lock is not reentrant, and doing so would
 * deadlock.
 *
 * Presence/radio watcher creation and cancellation also happen inside this same lock acquisition
 * (Task 8 review, Ruling 7): a concurrent [start] and [stopAndRotate] that touched the watcher
 * list outside the lock could leave watchers bound to a radio that has already been stopped and
 * rotated away, with nothing left to cancel them.
 */
class MeshBridge(private val emit: (String, Map<String, Any?>) -> Unit) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var watchers: List<Job> = emptyList()
    private var bluetoothReceiver: BroadcastReceiver? = null
    private var receiverContext: Context? = null

    /**
     * Runs [block] under this bridge's lock (Ruling 9): XMTPModule creates mesh clients inside
     * it, so reading and binding a node file is serialized against every rotation. Do not call
     * back into this MeshBridge from [block] (the lock is not reentrant).
     */
    suspend fun <T> withNodeLock(block: suspend () -> T): T = lock.withLock { block() }

    /**
     * Idempotent (Review Focus 2): Mesh.start returns the running radio, and one set of
     * collectors serves it; a repeated start adds none.
     *
     * Ruling 10 (SP3 final review I3): [Mesh] is a process singleton but XMTPModule and its
     * clients are recreated on every JS reload, so the running radio may serve a Client that
     * JS no longer holds. For the same installation with a different Client object this stops
     * and restarts the radio (rebind); for a different installation it rejects with
     * E_MESH_BUSY — call [stop] first.
     */
    suspend fun start(context: Context, client: Client, options: MeshOptions) {
        val app = context.applicationContext
        lock.withLock {
            val serving = running
            if (serving != null && Mesh.radio != null && serving.installationId != client.installationId) {
                throw CodedException(
                    "E_MESH_BUSY",
                    "The mesh radio is serving installation ${serving.installationId}; call Mesh.stop() first",
                    null,
                )
            }
            if (Mesh.radio != null && serving?.client !== client) {
                // Rebind: the radio (and the node's sync) is bound to another Client object.
                cancelWatchers()
                Mesh.stop(app)
                running = null
            }
            val radio = Mesh.start(app, client, options)
            running = Running(client.installationId, client, options.dbPath)
            if (watchers.isEmpty()) watchers = watch(radio)
        }
    }

    /** Stops sync, the radio and the foreground service; tells JS nobody is nearby. */
    suspend fun stop(context: Context) {
        lock.withLock {
            cancelWatchers()
            Mesh.stop(context.applicationContext)
            running = null
            // Inside the lock (SP3 final review M1): emitted after the lock, this could follow a
            // concurrent start's "up" and leave JS showing the radio down.
            emitStopped()
        }
    }

    /**
     * Stops the radio only if it serves [installationId] (SP3 final review M3): a dropped client
     * must not stay pinned by the node → sync → client cycle, serving a Client JS no longer holds.
     */
    suspend fun stopIfServing(context: Context, installationId: String) {
        lock.withLock {
            if (running?.installationId != installationId) return@withLock
            cancelWatchers()
            Mesh.stop(context.applicationContext)
            running = null
            emitStopped()
        }
    }

    /**
     * Recovery only (Ruling 8): stops the radio and moves [inboxId]'s node (every inbox's when
     * null) to a fresh generation. Not needed for correctness: a client whose inbox has no
     * libxmtp DB yet gets a fresh node on its own ([nodeForClientLocked]). An inbox whose libxmtp
     * DB is kept then reopens on an empty node that does not know its installation.
     */
    suspend fun resetNode(context: Context, inboxId: String?) {
        stopAndRotate(context, inboxId)
    }

    /**
     * Stops the radio, runs [between] (e.g. `client.deleteLocalDatabase()`), and moves
     * [inboxId]'s next client to a fresh node database (MeshNodeFiles.rotate; every inbox when
     * null) — all under one acquisition of this bridge's lock. See the class doc for why [stop]
     * and a rotate must never be composed as two separate calls instead of this one.
     */
    suspend fun stopAndRotate(
        context: Context,
        inboxId: String?,
        between: suspend () -> Unit = {},
    ) {
        val app = context.applicationContext
        lock.withLock {
            try {
                cancelWatchers()
                Mesh.stop(app)
                running = null
                between()
                if (inboxId != null) {
                    MeshNodeFiles.forInbox(app, inboxId).rotate()
                } else {
                    MeshNodeFiles.rotateAll(MeshNodeFiles.defaultDbDirectory(app))
                }
            } finally {
                // Inside the lock (M1), and even when `between` throws (M2): the watchers are
                // gone either way, so JS must not keep its last "up" and peer list.
                emitStopped()
            }
        }
    }

    /**
     * The node a new client of [inboxId] should open (Ruling 8): per inbox, and a fresh
     * generation when that inbox's libxmtp DB (in [dbDirectory], the app default when null)
     * does not exist yet, because the client is about to mint a new installation. Refuses with
     * E_MESH_BUSY instead of rotating a node that is still open ([openNodePaths]: the nodes of
     * this module's live mesh clients; plus the running radio's): a rotation deletes the old
     * generation's files.
     * Call only inside [withNodeLock].
     */
    fun nodeForClientLocked(
        context: Context,
        inboxId: String,
        encryptionKey: ByteArray,
        dbDirectory: String?,
        openNodePaths: Collection<String>,
    ): MeshOptions {
        val app = context.applicationContext
        val files = MeshNodeFiles.forInbox(app, inboxId)
        val libxmtpDb = MeshNodeFiles.libxmtpDbFile(
            dbDirectory?.let { File(it) } ?: MeshNodeFiles.defaultDbDirectory(app),
            inboxId,
        )
        val current = files.current().absolutePath
        if (!libxmtpDb.exists() && (current in openNodePaths || current == running?.nodePath)) {
            throw CodedException(
                "E_MESH_BUSY",
                "The mesh node for inbox $inboxId is still open; delete or drop its client first",
                null,
            )
        }
        return MeshOptions(files.forClient(libxmtpDb).absolutePath, encryptionKey)
    }

    fun setPairingMode(enabled: Boolean) {
        Mesh.radio?.setPairingMode(enabled)
    }

    fun peersJson(): String = MeshJson.peers(Mesh.radio?.verifiedPeers?.value?.values ?: emptyList())

    fun radioJson(): String = MeshJson.radio(Mesh.radio?.radioUp?.value ?: false, Mesh.foreground.value)

    /**
     * The key-package gate (SP2 I2): true once the local node holds a valid package for the peer.
     * Validates [peerInstallationIdHex] as 32-byte hex first (Task 8 review, Ruling 7):
     * `hexToByteArray` would otherwise silently decode a malformed id into garbage bytes and the
     * call would just read back as `false` instead of surfacing the caller's mistake.
     */
    suspend fun canMessage(client: Client, peerInstallationIdHex: String): Boolean {
        if (!INSTALLATION_ID_HEX.matches(peerInstallationIdHex)) {
            throw CodedException(
                "E_BAD_INSTALLATION_ID",
                "Not a 32-byte hex installation id: $peerInstallationIdHex",
                null,
            )
        }
        return client.meshCanMessage(peerInstallationIdHex.hexToByteArray())
    }

    /** Also starts watching the adapter, so later changes arrive as bluetoothState events. */
    fun bluetoothJson(context: Context): String {
        ensureBluetoothReceiver(context.applicationContext)
        return currentBluetoothJson(context.applicationContext)
    }

    fun requestedPermissionsJson(): String = MeshJson.strings(MeshPermissions.requested(Build.VERSION.SDK_INT))

    fun dispose() {
        val ctx = receiverContext
        val receiver = bluetoothReceiver
        if (ctx != null && receiver != null) runCatching { ctx.unregisterReceiver(receiver) }
        bluetoothReceiver = null
        receiverContext = null
        watchers = emptyList()
        scope.cancel()
    }

    /** Must be called from inside a [lock] acquisition (Task 8 review, Ruling 7). */
    private suspend fun cancelWatchers() {
        watchers.forEach { it.cancelAndJoin() }
        watchers = emptyList()
    }

    private fun emitStopped() {
        emit(EVENT_PEERS, mapOf("json" to MeshJson.peers(emptyList())))
        emit(EVENT_RADIO, mapOf("json" to MeshJson.radio(up = false, foreground = false)))
    }

    private fun watch(radio: MeshRadio): List<Job> =
        listOf(
            scope.launch {
                radio.verifiedPeers.collect { emit(EVENT_PEERS, mapOf("json" to MeshJson.peers(it.values))) }
            },
            scope.launch {
                combine(radio.radioUp, Mesh.foreground) { up, fg -> MeshJson.radio(up, fg) }
                    .collect { emit(EVENT_RADIO, mapOf("json" to it)) }
            },
        )

    private fun currentBluetoothJson(context: Context): String {
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
        val state = when {
            adapter == null -> "unsupported"
            else ->
                try {
                    if (adapter.isEnabled) "on" else "off"
                } catch (e: SecurityException) {
                    // isEnabled() is annotated @RequiresPermission(BLUETOOTH_CONNECT) on API 31+;
                    // some OEMs enforce it at the binder call instead of just logging a warning
                    // (Task 8 review, Ruling 7).
                    "noPermission"
                }
        }
        val missing = MeshPermissions.required(Build.VERSION.SDK_INT).filter {
            context.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
        }
        return MeshJson.bluetooth(state, missing)
    }

    @Synchronized
    private fun ensureBluetoothReceiver(context: Context) {
        if (bluetoothReceiver != null) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                emit(EVENT_BLUETOOTH, mapOf("json" to currentBluetoothJson(c.applicationContext)))
            }
        }
        ContextCompat.registerReceiver(
            context,
            receiver,
            IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        bluetoothReceiver = receiver
        receiverContext = context
    }

    /** What the running radio serves (Ruling 10). */
    private class Running(val installationId: String, val client: Client, val nodePath: String)

    companion object {
        /** The (installation, Client, node) the running radio serves; process-wide like [lock]. */
        private var running: Running? = null

        /**
         * Process-wide, like [Mesh] itself: XMTPModule (and this bridge) is recreated on every JS
         * reload, and a create still running in the old instance must serialize against a
         * rotate in the new one.
         */
        private val lock = Mutex()

        private const val NODE_MISMATCH = "a mesh node serves exactly one local installation"

        /**
         * Ruling 8: libxmtp's "a mesh node serves exactly one local installation" (the node is
         * bound to another installation) becomes the coded error E_MESH_NODE_MISMATCH.
         */
        suspend fun <T> mapNodeMismatch(block: suspend () -> T): T =
            try {
                block()
            } catch (e: Exception) {
                if (generateSequence<Throwable>(e) { it.cause }.any { it.message?.contains(NODE_MISMATCH) == true }) {
                    throw CodedException("E_MESH_NODE_MISMATCH", e.message ?: NODE_MISMATCH, e)
                }
                throw e
            }

        const val EVENT_PEERS = "meshPeers"
        const val EVENT_RADIO = "meshRadio"
        const val EVENT_BLUETOOTH = "bluetoothState"

        /** A 32-byte installation id (XMTP's InstallationId) as 64 hex characters, either case. */
        private val INSTALLATION_ID_HEX = Regex("^[0-9a-fA-F]{64}$")
    }
}
