"use client";
import { forwardRef, type TableHTMLAttributes } from "react";

/** Screen tables share one keyboard-accessible scrolling boundary. Print/export
 * templates deliberately continue to use their own ordinary HTML tables. */
const ResponsiveTable = forwardRef<HTMLTableElement, TableHTMLAttributes<HTMLTableElement>>(
  function ResponsiveTable({ children, className = "", ...props }, ref) {
    return <div className="responsive-table-region" role="region" tabIndex={0}
      aria-label={props["aria-label"] || "Scrollable table"}>
      <table {...props} ref={ref} className={`responsive-table ${className}`.trim()}>{children}</table>
    </div>;
  },
);
export default ResponsiveTable;
