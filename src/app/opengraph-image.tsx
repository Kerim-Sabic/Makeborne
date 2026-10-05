import { ImageResponse } from "next/og";
import BrandMark from "@/components/brand-mark";

export const alt = "Makeborne — Your creation and client workspace for websites, books, and presentations";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 64px", color: "#222228", background: "linear-gradient(125deg, #f5f7ff 0%, #f1eff9 52%, #e6edff 100%)", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, fontWeight: 600, letterSpacing: -1 }}>
        <BrandMark size={42} />
        <span>Makeborne</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 80, lineHeight: 1.07, letterSpacing: -4, fontWeight: 600 }}><span>Make something</span><span>worth opening.</span></div>
        <div style={{ display: "flex", fontSize: 26, color: "#666777", letterSpacing: -0.5 }}>Websites. Books. Presentations.</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #d8dbe8", paddingTop: 22, fontSize: 20, color: "#626474" }}>
        <span>Your creation &amp; client workspace</span>
        <span>makeborne.com</span>
      </div>
    </div>,
    size,
  );
}
