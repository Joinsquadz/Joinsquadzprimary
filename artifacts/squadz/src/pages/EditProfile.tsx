import { useState } from "react";
import { useLocation } from "wouter";
import { PhoneShell } from "@/components/PhoneShell";
import { Btn, Input } from "@/components/shared";
import { T, font } from "@/lib/data";

export default function EditProfile() {
  const [, setLocation] = useLocation();
  const [name, setName] = useState("Jordan Kim");
  const [username, setUsername] = useState("jordank");
  const [bio, setBio] = useState("Always down for a good time");

  return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setLocation("/home")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 20, cursor: "pointer", padding: 0 }}>←</button>
          <div style={{ flex: 1, fontFamily: "'Georgia', serif", fontSize: 18, fontWeight: 700, color: T.white }}>Edit Profile</div>
          <button onClick={() => setLocation("/home")} style={{ background: T.accent, border: "none", color: "#fff", borderRadius: 10, padding: "6px 14px", fontFamily: font, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Save</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "24px 20px" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 32 }}>
              <div style={{ position: "relative", marginBottom: 12 }}>
                <div style={{ width: 90, height: 90, borderRadius: 45, background: `linear-gradient(135deg, ${T.accent}, ${T.gold})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, fontWeight: 800, color: "#000" }}>J</div>
                <div style={{ position: "absolute", bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, background: T.accent, border: `2px solid ${T.bg}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, color: "#fff" }}>+</div>
              </div>
              <div style={{ fontSize: 13, color: T.accent, cursor: "pointer", fontFamily: font }}>Change photo</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: T.textDim, fontFamily: font, marginBottom: 6 }}>Display Name</div>
                <Input value={name} onChange={setName} icon="👤" />
              </div>
              <div>
                <div style={{ fontSize: 12, color: T.textDim, fontFamily: font, marginBottom: 6 }}>Username</div>
                <Input value={username} onChange={setUsername} icon="@" />
              </div>
              <div>
                <div style={{ fontSize: 12, color: T.textDim, fontFamily: font, marginBottom: 6 }}>Bio</div>
                <div style={{ position: "relative" }}>
                  <textarea value={bio} onChange={e => setBio(e.target.value)} style={{ width: "100%", background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 12, padding: "13px 14px", color: T.text, fontFamily: font, fontSize: 15, outline: "none", boxSizing: "border-box", resize: "none", minHeight: 80 }} />
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                <Btn variant="danger" onPress={() => setLocation("/home")}>Delete Account</Btn>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PhoneShell>
  );
}
