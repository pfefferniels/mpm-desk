import type { ReactNode } from "react";

/** The line under a chart that says in words what it draws. */
export const Caption = ({ color, children }: { color: string; children: ReactNode }) => (
    <div style={{ padding: "0 10px 8px", fontSize: 11, lineHeight: 1.35, color, maxWidth: 220 }}>{children}</div>
);
