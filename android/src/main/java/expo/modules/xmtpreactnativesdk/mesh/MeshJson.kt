package expo.modules.xmtpreactnativesdk.mesh

import com.google.gson.Gson
import org.xmtp.android.library.mesh.MeshIdentityEvent
import org.xmtp.android.library.mesh.MeshIdentityOutcome
import org.xmtp.android.library.mesh.MeshRelayState
import org.xmtp.android.library.toHex
import uniffi.xmtpv3.FfiRelayStats
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

    fun identity(event: MeshIdentityEvent): String =
        gson.toJson(
            mapOf(
                "inboxId" to event.inboxId,
                "outcome" to
                    when (event.outcome) {
                        MeshIdentityOutcome.RELOADED -> "reloaded"
                        MeshIdentityOutcome.REBASE_NEEDED -> "rebaseNeeded"
                        MeshIdentityOutcome.TOO_MANY_INSTALLATIONS -> "tooManyInstallations"
                    },
            )
        )

    fun relay(state: MeshRelayState): String =
        gson.toJson(
            mapOf(
                "userEnabled" to state.userEnabled,
                "pausedForBattery" to state.pausedForBattery,
                "active" to state.active,
            )
        )

    fun relayStats(s: FfiRelayStats?): String =
        if (s == null) {
            "null"
        } else {
            gson.toJson(
                mapOf(
                    "accepted" to s.accepted.toLong(),
                    "duplicate" to s.duplicate.toLong(),
                    "droppedInvalid" to s.droppedInvalid.toLong(),
                    "droppedExpired" to s.droppedExpired.toLong(),
                    "droppedShare" to s.droppedShare.toLong(),
                    "droppedRate" to s.droppedRate.toLong(),
                    "pushed" to s.pushed.toLong(),
                    "originated" to s.originated.toLong(),
                    "delivered" to s.delivered.toLong(),
                    "deliveredUnspooled" to s.deliveredUnspooled.toLong(),
                    "refsSent" to s.refsSent.toLong(),
                )
            )
        }
}
