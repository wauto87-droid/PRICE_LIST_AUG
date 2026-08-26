"use client";
import { useEffect, useState } from "react";
export default function ConnectionNotice() {
  const [insecure, setInsecure] = useState(false);
  useEffect(() => {
    setInsecure(location.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname));
  }, []);
  return insecure ? <aside role="alert" style={{ background: "#fff0c2", color: "#553900", padding: 12, fontWeight: 800, textAlign: "center" }}>
    Temporary HTTP access: connection is not encrypted. PWA installation requires HTTPS.
    <br />اتصال مؤقت غير مشفر. يتطلب تثبيت التطبيق اتصال HTTPS.
  </aside> : null;
}
