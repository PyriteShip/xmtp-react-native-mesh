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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
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
 */
class MeshBridge(private val emit: (String, Map<String, Any?>) -> Unit) {
    private val lock = Mutex()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var watchers: List<Job> = emptyList()
    private var bluetoothReceiver: BroadcastReceiver? = null
    private var receiverContext: Context? = null

    /**
     * Idempotent (Review Focus 2): Mesh.start returns the running radio, and one set of
     * collectors serves it; a repeated start adds none.
     */
    suspend fun start(context: Context, client: Client, options: MeshOptions) {
        val radio = lock.withLock { Mesh.start(context.applicationContext, client, options) }
        synchronized(this) {
            if (watchers.isEmpty()) watchers = watch(radio)
        }
    }

    /** Stops sync, the radio and the foreground service; tells JS nobody is nearby. */
    suspend fun stop(context: Context) {
        cancelWatchers()
        lock.withLock { Mesh.stop(context.applicationContext) }
        emitStopped()
    }

    /** For a host with no live client (e.g. delete identity after a failed start): fresh node DB. */
    suspend fun resetNode(context: Context) {
        stopAndRotate(context)
    }

    /**
     * Stops the radio, runs [between] (e.g. `client.deleteLocalDatabase()`), and moves the next
     * client to a fresh node database (MeshNodeFiles.rotate) — all under one acquisition of this
     * bridge's lock. See the class doc for why [stop] and a rotate must never be composed as two
     * separate calls instead of this one.
     */
    suspend fun stopAndRotate(context: Context, between: suspend () -> Unit = {}) {
        cancelWatchers()
        val app = context.applicationContext
        lock.withLock {
            Mesh.stop(app)
            between()
            MeshNodeFiles.inAppFiles(app).rotate()
        }
        emitStopped()
    }

    fun setPairingMode(enabled: Boolean) {
        Mesh.radio?.setPairingMode(enabled)
    }

    fun peersJson(): String = MeshJson.peers(Mesh.radio?.verifiedPeers?.value?.values ?: emptyList())

    fun radioJson(): String = MeshJson.radio(Mesh.radio?.radioUp?.value ?: false, Mesh.foreground.value)

    /** The key-package gate (SP2 I2): true once the local node holds a valid package for the peer. */
    suspend fun canMessage(client: Client, peerInstallationIdHex: String): Boolean =
        client.meshCanMessage(peerInstallationIdHex.hexToByteArray())

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
        scope.cancel()
    }

    private fun cancelWatchers() {
        synchronized(this) {
            watchers.forEach { it.cancel() }
            watchers = emptyList()
        }
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
            adapter.isEnabled -> "on"
            else -> "off"
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

    companion object {
        const val EVENT_PEERS = "meshPeers"
        const val EVENT_RADIO = "meshRadio"
        const val EVENT_BLUETOOTH = "bluetoothState"
    }
}
