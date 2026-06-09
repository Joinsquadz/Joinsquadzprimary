import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Platform,
  Alert,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { useUserCache } from "@/context/UserCacheContext";
import { UserAvatar } from "@/components/UserAvatar";
import { GradientButton } from "@/components/GradientButton";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return { first: parts[0] ?? "", last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export default function EditProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser, authToken, refreshUser } = useAuth();
  const { seedUser } = useUserCache();

  const initial = splitName(currentUser.name);
  const [firstName, setFirstName] = useState(initial.first);
  const [lastName, setLastName] = useState(initial.last);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [venmo, setVenmo] = useState("");
  const [cashapp, setCashapp] = useState("");
  const [zelle, setZelle] = useState("");
  const [saving, setSaving] = useState(false);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  function authHeaders(): Record<string, string> {
    return buildAuthHeaders(authToken);
  }

  // Load the user's saved payment handles so they can edit them in place.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/user/preferences`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = (await res.json()) as {
          venmoHandle?: string | null;
          cashappHandle?: string | null;
          zelleHandle?: string | null;
        };
        if (!active) return;
        setVenmo(data.venmoHandle ?? "");
        setCashapp(data.cashappHandle ?? "");
        setZelle(data.zelleHandle ?? "");
      } catch {
        // Non-blocking: handles just stay empty if the fetch fails.
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickPhoto() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow photo access to update your profile picture.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  }

  async function uploadPhoto(uri: string): Promise<string | null> {
    try {
      const resp = await fetch(uri);
      const blob = await resp.blob();
      const urlRes = await fetch(`${API_BASE}/api/storage/uploads/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: `avatar-${Date.now()}.jpg`, size: blob.size, contentType: blob.type || "image/jpeg", isPublicAccess: true }),
      });
      if (!urlRes.ok) return null;
      const { uploadURL, objectPath } = await urlRes.json() as { uploadURL: string; objectPath: string };
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": blob.type || "image/jpeg" },
      });
      if (!putRes.ok) return null;
      return `/api/storage${objectPath}`;
    } catch {
      return null;
    }
  }

  async function handleSave() {
    if (!firstName.trim()) {
      Alert.alert("Name required", "Please enter your first name.");
      return;
    }
    setSaving(true);
    try {
      let profileImageUrl: string | undefined;
      if (photoUri) {
        const uploaded = await uploadPhoto(photoUri);
        if (!uploaded) {
          Alert.alert("Upload failed", "Couldn't upload your photo. Your name will still be saved.");
        } else {
          profileImageUrl = uploaded;
        }
      }

      const body: Record<string, unknown> = {
        firstName: firstName.trim(),
        lastName: lastName.trim() || null,
        venmoHandle: venmo.trim() || null,
        cashappHandle: cashapp.trim() || null,
        zelleHandle: zelle.trim() || null,
      };
      if (profileImageUrl) body.profileImageUrl = profileImageUrl;

      const res = await fetch(`${API_BASE}/api/user/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        Alert.alert("Error", "Couldn't save your profile. Please try again.");
        return;
      }
      await refreshUser();

      // Propagate updated profile into UserCacheContext so squad/event screens
      // show the new photo immediately without waiting for a cache re-fetch.
      const updatedFirstName = firstName.trim();
      const updatedLastName = lastName.trim();
      const updatedName = [updatedFirstName, updatedLastName].filter(Boolean).join(" ") || "Unknown";
      const updatedInitials =
        updatedFirstName && updatedLastName
          ? `${updatedFirstName[0]}${updatedLastName[0]}`.toUpperCase()
          : updatedFirstName
          ? updatedFirstName.slice(0, 2).toUpperCase()
          : "U?";
      seedUser({
        id: currentUser.id,
        name: updatedName,
        initials: updatedInitials,
        color: currentUser.color,
        profileImageUrl: profileImageUrl ?? currentUser.profileImageUrl ?? null,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch {
      Alert.alert("Error", "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Edit Profile</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <View style={styles.avatarWrap}>
          <TouchableOpacity onPress={pickPhoto} activeOpacity={0.8}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.avatarImg} />
            ) : (
              <UserAvatar initials={currentUser.initials} color={currentUser.color} imageUrl={currentUser.profileImageUrl} size={96} fontSize={34} />
            )}
            <View style={[styles.cameraBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
              <Ionicons name="camera" size={16} color="#fff" />
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={pickPhoto}>
            <Text style={[styles.changePhoto, { color: colors.primary }]}>Change photo</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.label, { color: colors.mutedForeground }]}>First name</Text>
        <TextInput
          value={firstName}
          onChangeText={setFirstName}
          placeholder="First name"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
        />

        <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 16 }]}>Last name</Text>
        <TextInput
          value={lastName}
          onChangeText={setLastName}
          placeholder="Last name (optional)"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
        />

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Payment handles</Text>
        <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>
          Squad members use these to pay you back when settling up. Leave blank to hide.
        </Text>

        <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 16 }]}>Venmo</Text>
        <TextInput
          value={venmo}
          onChangeText={setVenmo}
          placeholder="@your-venmo"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
        />

        <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 16 }]}>Cash App</Text>
        <TextInput
          value={cashapp}
          onChangeText={setCashapp}
          placeholder="$yourcashtag"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
        />

        <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 16 }]}>Zelle</Text>
        <TextInput
          value={zelle}
          onChangeText={setZelle}
          placeholder="email or phone"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
        />

        <View style={{ marginTop: 28 }}>
          {saving ? (
            <View style={[styles.savingBtn, { backgroundColor: colors.primary }]}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : (
            <GradientButton label="Save Changes" onPress={handleSave} />
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  avatarWrap: { alignItems: "center", marginBottom: 28 },
  avatarImg: { width: 96, height: 96, borderRadius: 48 },
  cameraBadge: { position: "absolute", bottom: 0, right: 0, width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  changePhoto: { marginTop: 12, fontSize: 14, fontWeight: "600" },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginTop: 28 },
  sectionSub: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: "600", marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15 },
  savingBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center", justifyContent: "center" },
});
