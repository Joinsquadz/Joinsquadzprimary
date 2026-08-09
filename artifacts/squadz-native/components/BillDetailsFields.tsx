import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { calculateBillTotal } from "@/lib/costSplit";
import type { CostBillDetails } from "@/types";

type Colors = ReturnType<typeof useColors>;

const TIP_PRESETS = [15, 18, 20];

const inputAmount = (value: string): number => parseFloat(value) || 0;

/**
 * Optional bill-detail entry state shared by the event and trip expense forms.
 * When `show` is false the caller keeps its plain single-total flow untouched.
 */
export function useBillDetailsForm() {
  const [show, setShow] = useState(false);
  const [baseAmount, setBaseAmount] = useState("");
  const [taxAmount, setTaxAmount] = useState("");
  const [tipAmount, setTipAmount] = useState("");
  const [tipPercent, setTipPercent] = useState<string | null>(null);
  const [feeAmount, setFeeAmount] = useState("");

  const billDetails: CostBillDetails | undefined = show
    ? {
        ...(baseAmount.trim() ? { baseAmount: inputAmount(baseAmount) } : {}),
        ...(taxAmount.trim() ? { taxAmount: inputAmount(taxAmount) } : {}),
        ...(tipPercent !== null && tipPercent.trim()
          ? { tipPercent: inputAmount(tipPercent) }
          : tipAmount.trim()
            ? { tipAmount: inputAmount(tipAmount) }
            : {}),
        ...(feeAmount.trim() ? { feeAmount: inputAmount(feeAmount) } : {}),
      }
    : undefined;

  /** Cent-exact grand total of every entered part; 0 when nothing is entered. */
  const billTotal = calculateBillTotal(billDetails ?? {});

  const reset = () => {
    setShow(false);
    setBaseAmount("");
    setTaxAmount("");
    setTipAmount("");
    setTipPercent(null);
    setFeeAmount("");
  };

  /** Repopulates the form from a saved expense so edits stay transparent. */
  const loadFrom = (details?: CostBillDetails) => {
    setShow(!!details);
    setBaseAmount(details?.baseAmount != null ? String(details.baseAmount) : "");
    setTaxAmount(details?.taxAmount != null ? String(details.taxAmount) : "");
    setTipAmount(details?.tipAmount != null ? String(details.tipAmount) : "");
    setTipPercent(details?.tipPercent != null ? String(details.tipPercent) : null);
    setFeeAmount(details?.feeAmount != null ? String(details.feeAmount) : "");
  };

  return {
    show,
    setShow,
    baseAmount,
    setBaseAmount,
    taxAmount,
    setTaxAmount,
    tipAmount,
    setTipAmount,
    tipPercent,
    setTipPercent,
    feeAmount,
    setFeeAmount,
    billDetails,
    billTotal,
    reset,
    loadFrom,
  };
}

export type BillDetailsForm = ReturnType<typeof useBillDetailsForm>;

/** One-line receipt summary of a saved expense's breakdown. */
export function formatBillDetails(details: CostBillDetails): string {
  return [
    details.baseAmount != null && `Base $${details.baseAmount.toFixed(2)}`,
    details.taxAmount != null && `Tax $${details.taxAmount.toFixed(2)}`,
    details.tipPercent != null
      ? `Tip ${details.tipPercent}%`
      : details.tipAmount != null && `Tip $${details.tipAmount.toFixed(2)}`,
    details.feeAmount != null && `Fees $${details.feeAmount.toFixed(2)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Toggle + optional base/tax/tip/fee controls with a live grand total. */
export function BillDetailsFields({ form }: { form: BillDetailsForm }) {
  const colors = useColors();
  const {
    show,
    setShow,
    baseAmount,
    setBaseAmount,
    taxAmount,
    setTaxAmount,
    tipAmount,
    setTipAmount,
    tipPercent,
    setTipPercent,
    feeAmount,
    setFeeAmount,
    billTotal,
  } = form;

  return (
    <>
      <TouchableOpacity onPress={() => setShow(!show)} style={styles.toggle}>
        <Ionicons name={show ? "remove-circle-outline" : "receipt-outline"} size={16} color={colors.primary} />
        <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 13 }}>
          {show ? "Hide bill details" : "Add bill details (tax, tip, fees)"}
        </Text>
      </TouchableOpacity>
      {show && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Bill details</Text>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            The grand total below replaces the amount above.
          </Text>
          <View style={styles.row}>
            <BillInput label="Base" value={baseAmount} onChangeText={setBaseAmount} colors={colors} />
            <BillInput label="Tax" value={taxAmount} onChangeText={setTaxAmount} colors={colors} />
          </View>
          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Tip</Text>
          <View style={styles.tipPresets}>
            {TIP_PRESETS.map((percent) => {
              const active = tipPercent === String(percent);
              return (
                <TouchableOpacity
                  key={percent}
                  onPress={() => {
                    setTipPercent(active ? null : String(percent));
                    setTipAmount("");
                  }}
                  style={[
                    styles.tipPreset,
                    {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primary + "14" : "transparent",
                    },
                  ]}
                >
                  <Text style={{ color: active ? colors.primary : colors.mutedForeground, fontWeight: "800", fontSize: 12 }}>
                    {percent}%
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.row}>
            <BillInput
              label="Custom %"
              unit="%"
              value={tipPercent ?? ""}
              onChangeText={(value) => {
                setTipPercent(value);
                setTipAmount("");
              }}
              colors={colors}
            />
            <BillInput
              label="Flat tip"
              value={tipAmount}
              onChangeText={(value) => {
                setTipAmount(value);
                setTipPercent(null);
              }}
              colors={colors}
            />
          </View>
          <View style={styles.row}>
            <BillInput label="Fees" value={feeAmount} onChangeText={setFeeAmount} colors={colors} />
            <View style={styles.billInput} />
          </View>
          <View style={[styles.grandTotal, { borderTopColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.foreground }]}>Grand total</Text>
            <Text style={[styles.grandTotalAmount, { color: colors.primary }]}>${billTotal.toFixed(2)}</Text>
          </View>
        </View>
      )}
    </>
  );
}

function BillInput({
  label,
  value,
  onChangeText,
  colors,
  unit = "$",
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  colors: Colors;
  unit?: string;
}) {
  return (
    <View style={styles.billInput}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[styles.inputBox, { borderColor: colors.border }]}>
        <Text style={[styles.unit, { color: colors.textDim }]}>{unit}</Text>
        <TextInput
          placeholder={unit === "%" ? "0" : "0.00"}
          placeholderTextColor={colors.textDim}
          value={value}
          onChangeText={onChangeText}
          keyboardType="decimal-pad"
          style={[styles.inputText, { color: colors.foreground }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, alignSelf: "flex-start" },
  card: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 8, marginTop: 8 },
  title: { fontSize: 14, fontWeight: "800" },
  hint: { fontSize: 12, marginTop: -4 },
  row: { flexDirection: "row", gap: 8 },
  billInput: { flex: 1, gap: 4 },
  fieldLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  inputBox: { flexDirection: "row", alignItems: "center", gap: 3, height: 38, borderRadius: 9, borderWidth: 1, paddingHorizontal: 9 },
  unit: { fontSize: 15, fontWeight: "700" },
  inputText: { flex: 1, height: "100%", fontSize: 14, fontWeight: "700" },
  tipPresets: { flexDirection: "row", gap: 7, marginTop: -2 },
  tipPreset: { borderRadius: 9, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  grandTotal: { marginTop: 2, paddingTop: 10, borderTopWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  grandTotalAmount: { fontSize: 17, fontWeight: "900" },
});
