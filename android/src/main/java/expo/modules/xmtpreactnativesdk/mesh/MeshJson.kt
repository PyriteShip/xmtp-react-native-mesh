package expo.modules.xmtpreactnativesdk.mesh

import com.google.gson.Gson
import org.xmtp.android.library.toHex
import uniffi.xmtpv3.FfiVerifiedPeer

/** Every mesh value crossing to JS is a JSON string; src/lib/meshCodec.ts parses it. */
internal object MeshJson {
    private val gson = Gson()

    fun peers(peers: Collection<FfiVerifiedPeer>): String =
        gson.toJson(
            peers.sortedBy { it.peerId }.map {
                mapOf("peerId" to it.peerId, "inboxId" to it.inboxId, "installationId" to it.installationId.toHex())
            }
        )

    fun radio(up: Boolean, foreground: Boolean): String =
        gson.toJson(mapOf("up" to up, "foreground" to foreground))

    fun bluetooth(adapter: String, missingPermissions: List<String>): String =
        gson.toJson(mapOf("adapter" to adapter, "missingPermissions" to missingPermissions))

    fun strings(values: List<String>): String = gson.toJson(values)
}
