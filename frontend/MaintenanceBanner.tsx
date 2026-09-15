"use client";

import { appPath } from "../shared/paths";

export default function MaintenanceBanner({
  text,
  image,
  title,
  onBypass
}: {
  text: string;
  image?: string | null;
  title: string;
  onBypass?: () => void;
}) {
  return (
    <div className="maintenance-banner" style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      backgroundColor: "#f9fafb",
      textAlign: "center",
      padding: "2rem"
    }}>
      {image ? (
        <img 
          src={image} 
          alt="Maintenance" 
          style={{ maxWidth: "100%", maxHeight: "50vh", objectFit: "contain", marginBottom: "2rem" }} 
          onDoubleClick={onBypass}
        />
      ) : (
        <div onDoubleClick={onBypass} style={{ fontSize: "4rem", marginBottom: "1rem" }}>🚧</div>
      )}
      <h1 style={{ fontSize: "2.5rem", marginBottom: "1rem", color: "#111827" }}>
        {title}
      </h1>
      <p style={{ fontSize: "1.25rem", color: "#4b5563", maxWidth: "600px", whiteSpace: "pre-wrap" }}>
        {text}
      </p>
    </div>
  );
}
