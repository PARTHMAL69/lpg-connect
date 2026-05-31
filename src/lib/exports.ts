import { jsPDF } from "jspdf";
import "jspdf-autotable";
import * as XLSX from "xlsx";

export function exportToExcel(data: any[], fileName: string, sheetName = "Sheet1") {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  
  // Auto-fit column widths
  const maxProps = data.reduce((acc, row) => {
    Object.keys(row).forEach((key) => {
      const val = row[key] ? String(row[key]) : "";
      acc[key] = Math.max(acc[key] || 0, val.length, key.length);
    });
    return acc;
  }, {} as Record<string, number>);
  
  worksheet["!cols"] = Object.keys(maxProps).map((key) => ({
    wch: Math.min(Math.max(maxProps[key] + 2, 8), 40)
  }));

  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}

export function exportToPDF(title: string, headers: string[], rows: any[][], fileName: string) {
  const doc = new jsPDF() as any;
  
  // Custom Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(30, 58, 138); // Deep Navy Primary Color
  doc.text("GasFlow", 14, 18);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text("Modern LPG Agency Platform", 14, 23);
  
  doc.setDrawColor(226, 232, 240);
  doc.line(14, 26, 196, 26);
  
  // Document Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(title, 14, 35);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated on: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, 14, 40);

  // Table using autotable
  doc.autoTable({
    startY: 45,
    head: [headers],
    body: rows,
    theme: "striped",
    headStyles: { fillColor: [30, 58, 138], textColor: [255, 255, 255], fontStyle: "bold" },
    styles: { fontSize: 8.5, cellPadding: 3 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
    didDrawPage: (data: any) => {
      // Footer
      const str = `Page ${doc.internal.getNumberOfPages()}`;
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(str, doc.internal.pageSize.width - 20, doc.internal.pageSize.height - 10);
      doc.text("GasFlow Platform - Confidential Report", 14, doc.internal.pageSize.height - 10);
    }
  });

  doc.save(`${fileName}.pdf`);
}
