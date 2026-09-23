package expo.modules.xmtpreactnativesdk.mesh

import android.content.Context
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.xmtp.android.library.Client
import org.xmtp.android.library.mesh.Mesh
import org.xmtp.android.library.mesh.MeshNodeFiles
import org.xmtp.android.library.mesh.MeshOptions

/**
 * XMTPModule's handle on the Android mesh radio (org.xmtp.android.library.mesh.Mesh).
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

    /** Idempotent: Mesh.start returns the running radio when one is up. */
    suspend fun start(context: Context, client: Client, options: MeshOptions) {
        lock.withLock { Mesh.start(context.applicationContext, client, options) }
    }

    /** Stops sync, the radio and the foreground service; tells JS nobody is nearby. */
    suspend fun stop(context: Context) {
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
        val app = context.applicationContext
        lock.withLock {
            Mesh.stop(app)
            between()
            MeshNodeFiles.inAppFiles(app).rotate()
        }
        emitStopped()
    }

    private fun emitStopped() {
        emit(EVENT_PEERS, mapOf("json" to MeshJson.peers(emptyList())))
        emit(EVENT_RADIO, mapOf("json" to MeshJson.radio(up = false, foreground = false)))
    }

    fun setPairingMode(enabled: Boolean) {
        Mesh.radio?.setPairingMode(enabled)
    }

    fun peersJson(): String = MeshJson.peers(Mesh.radio?.verifiedPeers?.value?.values ?: emptyList())

    fun radioJson(): String = MeshJson.radio(Mesh.radio?.radioUp?.value ?: false, Mesh.foreground.value)

    companion object {
        const val EVENT_PEERS = "meshPeers"
        const val EVENT_RADIO = "meshRadio"
        const val EVENT_BLUETOOTH = "bluetoothState"
    }
}
