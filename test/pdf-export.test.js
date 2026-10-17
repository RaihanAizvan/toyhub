import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// Both exports this app writes - the admin sales report and the shopper invoice -
// draw a table with jspdf-autotable and then place text under it using
// doc.lastAutoTable.finalY. jspdf 4 and jspdf-autotable 5 move the plugin from a
// method patched onto the document to a function that takes the document, so this
// pins the shape the two call sites rely on: the function form draws, and the
// document still reports where the table ended.
describe("the PDF table export keeps the shape the call sites use", () => {
  it("draws through autoTable(doc, ...) and reports the table's end", () => {
    const doc = new jsPDF("landscape");

    autoTable(doc, {
      columns: [
        { header: "S.No", dataKey: "sno" },
        { header: "Name", dataKey: "name" },
        { header: "Total", dataKey: "total" },
      ],
      body: [
        { sno: 1, name: "Tiny Rover", total: "800.00" },
        { sno: 2, name: "Building Blocks", total: "450.00" },
      ],
      startY: 20,
      theme: "grid",
    });

    assert.equal(typeof doc.lastAutoTable.finalY, "number");
    assert.ok(doc.lastAutoTable.finalY > 20, "the table advanced down the page");

    const output = doc.output();
    assert.match(output, /^%PDF/, "the document is a PDF");
    assert.ok(output.length > 1000, "the table was drawn, not left empty");
  });

  it("an empty report still produces a readable document", () => {
    const doc = new jsPDF();

    autoTable(doc, {
      columns: [{ header: "Name", dataKey: "name" }],
      body: [],
      startY: 20,
    });

    assert.match(doc.output(), /^%PDF/);
  });
});