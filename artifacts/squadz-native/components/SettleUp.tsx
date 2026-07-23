import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { UserAvatar } from "@/components/UserAvatar";
import type { ResolvedUser } from "@/context/UserCacheContext";
import {
  computeOwed,
  computeOwedToMe,
  payWithVenmoHandle,
  payWithCashAppHandle,
  type PaymentStatus,
} from "@/lib/settle";
import type { Cost } from "@/types";

type Handles = { venmo: string | null; cashapp: string | null; zelle: string | null };

type Colors = {
  card: string;
  border: string;
  foreground: string;
  mutedForeground: string;
  textDim: string;
  primary: string;
  destructive: string;
  green: string;
};

function statusLabel(status: PaymentStatus): { text: string; tone: "muted" | "pending" | "done" } {
  if (status === "confirmed") return { text: "Confirmed", tone: "done" };
  if (status === "paid") return { text: "Marked paid", tone: "pending" };
  return { text: "Unpaid", tone: "muted" };
}

export function SettleUp({
  costs,
  meId,
  eventTitle,
  colors,
  handles,
  resolveUser,
  onMarkPaid,
  onConfirm,
  memberIds,
}: {
  costs: Cost[];
  meId: string;
  eventTitle: string;
  colors: Colors;
  handles: Record<string, Handles>;
  resolveUser: (id: string) => ResolvedUser;
  onMarkPaid: (costId: string, paid: boolean) => void;
  onConfirm: (costId: string, debtorId: string, confirmed: boolean) => void;
  /** Ids of the event's current participants (squad members + invited + host).
   *  Used to detect debtors/payers who have left the squad (D4). Optional: when
   *  omitted, departure is inferred from a failed name lookup alone. */
  memberIds?: Set<string>;
}) {
  const iOwe = computeOwed(costs, meId);
  const owedToMe = computeOwedToMe(costs, meId);

  // D4: a share/payer user who is neither me nor a current participant — or
  // whose profile can't be resolved at all — is rendered as a departed member
  // rather than a blank / placeholder. Never blank, never a crash.
  const displayFor = (userId: string): { name: string; user: ResolvedUser } => {
    const user = resolveUser(userId);
    const unresolved = !user.name || user.name === "..." || user.name === "Unknown";
    const departed = userId !== meId && (memberIds ? !memberIds.has(userId) : unresolved);
    if (!departed) return { name: user.name, user };
    const known = !unresolved;
    return { name: known ? `${user.name} (left squad)` : "Former member", user };
  };

  const toneColor = (tone: "muted" | "pending" | "done") =>
    tone === "done" ? colors.green : tone === "pending" ? colors.primary : colors.textDim;

  async function copyZelle(handle: string) {
    await Clipboard.setStringAsync(handle);
    Alert.alert("Zelle handle copied", `Send your payment to ${handle} in your banking app.`);
  }

  if (iOwe.length === 0 && owedToMe.length === 0) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.header, { color: colors.foreground }]}>Settle up</Text>
        <Text style={[styles.allClear, { color: colors.mutedForeground }]}>You're all settled up 🎉</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {iOwe.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.header, { color: colors.foreground }]}>You owe</Text>
          {iOwe.map((group) => {
            const { name: firstName, user: other } = displayFor(group.userId);
            const h = handles[group.userId] ?? { venmo: null, cashapp: null, zelle: null };
            const note = `${eventTitle} — settle up`;
            return (
              <View key={group.userId} style={[styles.group, { borderColor: colors.border }]}>
                <View style={styles.groupHead}>
                  <UserAvatar initials={other.initials} color={other.color} imageUrl={other.profileImageUrl} size={32} fontSize={11} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.name, { color: colors.foreground }]}>{firstName}</Text>
                    <Text style={[styles.amt, { color: colors.destructive }]}>
                      ${group.outstanding.toFixed(2)} outstanding
                    </Text>
                  </View>
                </View>
                {(h.venmo || h.cashapp || h.zelle) ? (
                  <View style={styles.payRow}>
                    {h.venmo && (
                      <TouchableOpacity
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          void payWithVenmoHandle(h.venmo!, group.outstanding, note);
                        }}
                        style={[styles.payBtn, { backgroundColor: "#3D95CE" }]}
                      >
                        <Text style={styles.payBtnText}>Venmo</Text>
                      </TouchableOpacity>
                    )}
                    {h.cashapp && (
                      <TouchableOpacity
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          void payWithCashAppHandle(h.cashapp!, group.outstanding);
                        }}
                        style={[styles.payBtn, { backgroundColor: "#00C244" }]}
                      >
                        <Text style={styles.payBtnText}>Cash App</Text>
                      </TouchableOpacity>
                    )}
                    {h.zelle && (
                      <TouchableOpacity
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); void copyZelle(h.zelle!); }}
                        style={[styles.payBtn, { backgroundColor: "#6D1ED4" }]}
                      >
                        <Text style={styles.payBtnText}>Zelle</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : (
                  <Text style={[styles.noHandlesHint, { color: colors.mutedForeground }]}>
                    Ask {firstName} to add a payment method in their profile.
                  </Text>
                )}
                {group.shares.map((s) => {
                  const label = statusLabel(s.status);
                  const locked = s.status === "confirmed";
                  const paid = s.status !== "unpaid";
                  return (
                    <View key={s.costId} style={styles.shareRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.shareDesc, { color: colors.foreground }]} numberOfLines={1}>{s.description}</Text>
                        <Text style={[styles.statusText, { color: toneColor(label.tone) }]}>{label.text}</Text>
                      </View>
                      <Text style={[styles.shareAmt, { color: colors.mutedForeground }]}>${s.amount.toFixed(2)}</Text>
                      <TouchableOpacity
                        disabled={locked}
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onMarkPaid(s.costId, !paid); }}
                        style={[styles.check, { borderColor: paid ? colors.green : colors.border, backgroundColor: paid ? colors.green : "transparent", opacity: locked ? 0.6 : 1 }]}
                      >
                        {paid && <Ionicons name="checkmark" size={16} color="#fff" />}
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>
      )}

      {owedToMe.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.header, { color: colors.foreground }]}>Owed to you</Text>
          {owedToMe.map((group) => {
            const { name: firstName, user: other } = displayFor(group.userId);
            return (
              <View key={group.userId} style={[styles.group, { borderColor: colors.border }]}>
                <View style={styles.groupHead}>
                  <UserAvatar initials={other.initials} color={other.color} imageUrl={other.profileImageUrl} size={32} fontSize={11} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.name, { color: colors.foreground }]}>{firstName}</Text>
                    <Text style={[styles.amt, { color: colors.green }]}>
                      ${group.outstanding.toFixed(2)} outstanding
                    </Text>
                  </View>
                </View>
                {group.shares.map((s) => {
                  const label = statusLabel(s.status);
                  return (
                    <View key={s.costId} style={styles.shareRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.shareDesc, { color: colors.foreground }]} numberOfLines={1}>{s.description}</Text>
                        <Text style={[styles.statusText, { color: toneColor(label.tone) }]}>{label.text}</Text>
                      </View>
                      <Text style={[styles.shareAmt, { color: colors.mutedForeground }]}>${s.amount.toFixed(2)}</Text>
                      {s.status === "paid" && (
                        <View style={styles.miniActions}>
                          <TouchableOpacity
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onConfirm(s.costId, group.userId, true); }}
                            style={[styles.miniBtn, { backgroundColor: colors.green }]}
                          >
                            <Text style={styles.miniBtnText}>Confirm</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onConfirm(s.costId, group.userId, false); }}
                            style={[styles.miniBtnOutline, { borderColor: colors.border }]}
                          >
                            <Text style={[styles.miniBtnText, { color: colors.mutedForeground }]}>Un-mark</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                      {s.status === "confirmed" && (
                        <TouchableOpacity
                          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onConfirm(s.costId, group.userId, false); }}
                          style={[styles.miniBtnOutline, { borderColor: colors.border }]}
                        >
                          <Text style={[styles.miniBtnText, { color: colors.mutedForeground }]}>Un-mark</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 12 },
  header: { fontSize: 15, fontWeight: "700" },
  allClear: { fontSize: 14 },
  group: { borderTopWidth: 1, paddingTop: 12, gap: 10 },
  groupHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { fontSize: 14, fontWeight: "600" },
  amt: { fontSize: 13, fontWeight: "700", marginTop: 1 },
  payRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  payBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  payBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  shareRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  shareDesc: { fontSize: 13, fontWeight: "500" },
  statusText: { fontSize: 11, marginTop: 1, fontWeight: "600" },
  shareAmt: { fontSize: 13, fontWeight: "600" },
  check: { width: 26, height: 26, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  miniActions: { flexDirection: "row", gap: 6 },
  miniBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7 },
  miniBtnOutline: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, borderWidth: 1 },
  miniBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  noHandlesHint: { fontSize: 12, fontStyle: "italic" },
});
