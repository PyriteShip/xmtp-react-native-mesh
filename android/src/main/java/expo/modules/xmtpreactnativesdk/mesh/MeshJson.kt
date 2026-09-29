package expo.modules.xmtpreactnativesdk.mesh

import com.google.gson.Gson
import org.xmtp.android.library.mesh.MeshIdentityEvent
import org.xmtp.android.library.mesh.MeshIdentityOutcome
import org.xmtp.android.library.mesh.MeshPairingState
import org.xmtp.android.library.mesh.MeshRelayState
import org.xmtp.android.library.toHex
import uniffi.xmtpv3.FfiContact
import uniffi.xmtpv3.FfiMeshStats
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
                    "droppedFull" to s.droppedFull.toLong(),
                    "pushed" to s.pushed.toLong(),
                    "originated" to s.originated.toLong(),
                    "delivered" to s.delivered.toLong(),
                    "deliveredUnspooled" to s.deliveredUnspooled.toLong(),
                    "refsSent" to s.refsSent.toLong(),
                )
            )
        }

    fun meshStats(s: FfiMeshStats?): String =
        if (s == null) {
            "null"
        } else {
            gson.toJson(
                mapOf(
                    "seqRowsSigned" to s.seqRowsSigned.toLong(),
                    "seqRowsVerified" to s.seqRowsVerified.toLong(),
                    "seqRejectedMissingProof" to s.seqRejectedMissingProof.toLong(),
                    "seqRejectedBadSignature" to s.seqRejectedBadSignature.toLong(),
                    "seqRejectedWrongSigner" to s.seqRejectedWrongSigner.toLong(),
                    "seqEquivocations" to s.seqEquivocations.toLong(),
                    "peersRejectedVersion" to s.peersRejectedVersion.toLong(),
                    "linksContact" to s.linksContact.toLong(),
                    "linksRelay" to s.linksRelay.toLong(),
                    "linksPairing" to s.linksPairing.toLong(),
                    "handshakeFailed" to s.handshakeFailed.toLong(),
                    "linkFrameRejected" to s.linkFrameRejected.toLong(),
                    "discoveryResets" to s.discoveryResets.toLong(),
                    "relayLinksIdleClosed" to s.relayLinksIdleClosed.toLong(),
                    "relayLinksForceClosed" to s.relayLinksForceClosed.toLong(),
                    "relayLinksBackoffRefused" to s.relayLinksBackoffRefused.toLong(),
                    "pairingAttemptsExhausted" to s.pairingAttemptsExhausted.toLong(),
                    "restoreContactsAdded" to s.restoreContactsAdded.toLong(),
                )
            )
        }

    fun pairing(state: MeshPairingState?): String =
        if (state == null) {
            "null"
        } else {
            gson.toJson(
                mapOf(
                    "on" to state.on,
                    "pending" to state.pending.map {
                        mapOf("peerId" to it.peerId, "code" to it.code, "confirmed" to it.confirmed, "peerConfirmed" to it.peerConfirmed)
                    },
                    "refusals" to state.refusals.map {
                        mapOf("peerId" to it.peerId, "code" to it.code, "conflictingInboxId" to it.conflictingInboxId)
                    },
                    "attemptsExhausted" to state.attemptsExhausted.toLong(),
                )
            )
        }

    fun contacts(list: List<FfiContact>?): String =
        if (list == null) {
            "null"
        } else {
            gson.toJson(list.map { mapOf("inboxId" to it.inboxId, "generation" to it.generation.toLong(), "autoAdded" to it.autoAdded) })
        }

    fun restoreWindow(until: ULong?): String = gson.toJson(mapOf("until" to until?.toLong()))
}
