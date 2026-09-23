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
 * [MeshNodeFiles] is not thread-safe against a concurrent [rotate] or against a concurrent
 * [Mesh.start]/[Mesh.stop] (see MeshNodeFiles.kt's own doc comment). [Mesh]'s own lock that
 * serializes its start/stop is private to that object, so this bridge keeps its own lock and
 * every method that starts, stops or rotates the node database takes it, so a rotate can never
 * race a start reading the same generation.
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
        emit(EVENT_PEERS, mapOf("json" to MeshJson.peers(emptyList())))
        emit(EVENT_RADIO, mapOf("json" to MeshJson.radio(up = false, foreground = false)))
    }

    /** For a host with no live client (e.g. delete identity after a failed start): fresh node DB. */
    suspend fun resetNode(context: Context) {
        stop(context)
        rotate(context)
    }

    /**
     * Moves the next client to a fresh node database (MeshNodeFiles.rotate). Call after [stop]:
     * `deleteLocalDatabase`'s mesh branch does so with the client's own database deleted in
     * between, under this bridge's lock either side.
     */
    suspend fun rotate(context: Context) {
        lock.withLock { MeshNodeFiles.inAppFiles(context.applicationContext).rotate() }
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
