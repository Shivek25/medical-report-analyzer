import { createRequire } from 'module';
import type { TDocumentDefinitions, Content, TableCell, StyleDictionary } from 'pdfmake/interfaces.js';
import type { ReportSummary, SummaryFinding, NormalEntry } from '../types/index.js';

const require = createRequire(import.meta.url);
const pdfMake = require('pdfmake');

const fonts = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

pdfMake.setFonts(fonts);

/**
 * Sanitizes text to remove characters that standard PDF fonts (WinAnsiEncoding) struggle with.
 */
function sanitizePdfText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/[\u2010-\u2015\u2212]/g, '-') // Replace various dashes and minus signs with standard hyphen
    .replace(/[\u03BC\u00B5]/g, 'u')        // Replace Greek mu and micro sign with 'u' (for ug/dL)
    .replace(/[\u2018\u2019]/g, "'")        // Replace smart single quotes
    .replace(/[\u201C\u201D]/g, '"')        // Replace smart double quotes
    .replace(/10\^6/g, '10⁶');              // Prettify scientific notation
}

/**
 * Generates a polished PDF report from a deterministic ReportSummary.
 * Returns a Promise that resolves with a Buffer containing the PDF data.
 */
export async function generatePdfReport(summary: ReportSummary): Promise<Buffer> {
  const docDefinition: TDocumentDefinitions = {
    defaultStyle: {
      font: 'Helvetica',
      fontSize: 10,
      color: '#333333',
    },
    pageSize: 'A4',
    pageMargins: [40, 60, 40, 60],
    styles: getStyles(),
    header: (currentPage: number, pageCount: number) => {
      return {
        text: `Page ${currentPage} of ${pageCount}`,
        alignment: 'right',
        margin: [40, 20, 40, 0],
        fontSize: 8,
        color: '#888888',
      };
    },
    content: buildContent(summary),
  };

  const pdfDoc = pdfMake.createPdf(docDefinition);
  return await pdfDoc.getBuffer();
}

function getStyles(): StyleDictionary {
  return {
    header: {
      fontSize: 22,
      bold: true,
      color: '#2C3E50',
      margin: [0, 0, 0, 10],
    },
    subheader: {
      fontSize: 14,
      bold: true,
      color: '#34495E',
      margin: [0, 15, 0, 5],
    },
    metaLabel: {
      bold: true,
      color: '#7F8C8D',
      fontSize: 9,
    },
    metaValue: {
      color: '#2C3E50',
      fontSize: 10,
    },
    overview: {
      fontSize: 11,
      lineHeight: 1.4,
      margin: [0, 10, 0, 15],
    },
    tableHeader: {
      bold: true,
      fontSize: 10,
      color: 'white',
    },
    tableCell: {
      margin: [2, 4, 2, 4],
    },
    disclaimerLabel: {
      bold: true,
      fontSize: 9,
      color: '#E74C3C',
    },
    disclaimerText: {
      fontSize: 8,
      color: '#7F8C8D',
      lineHeight: 1.3,
    },
  };
}

function buildContent(summary: ReportSummary): Content[] {
  const content: Content[] = [];

  // Title
  content.push({ text: 'Medical Report Summary', style: 'header' });

  // Metadata Section
  content.push(buildMetadataSection(summary));
  content.push({ canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 1, lineColor: '#DDDDDD' }], margin: [0, 10, 0, 10] });

  // Overview
  if (summary.overviewText) {
    content.push({ text: 'Overview', style: 'subheader' });
    content.push({ text: sanitizePdfText(summary.overviewText), style: 'overview' });
  }

  // Abnormal Findings
  if (summary.abnormalFindings && summary.abnormalFindings.length > 0) {
    content.push({ text: 'Abnormal Findings', style: 'subheader' });
    summary.abnormalFindings.forEach(group => {
      content.push({ text: sanitizePdfText(group.category), bold: true, margin: [0, 5, 0, 5], color: '#E74C3C' });
      content.push(buildFindingsTable(group.findings, '#E74C3C', '#FDEDEC'));
    });
  }

  // Uncertain Entries
  if (summary.uncertainEntries && summary.uncertainEntries.length > 0) {
    content.push({ text: 'Uncertain or Unparsable Entries', style: 'subheader' });
    content.push({
      text: 'The following entries could not be parsed confidently or are missing required information.',
      italics: true,
      fontSize: 9,
      margin: [0, 0, 0, 5],
    });
    content.push(buildFindingsTable(summary.uncertainEntries, '#F39C12', '#FEF5E7'));
  }

  // Normal Findings
  if (summary.normalFindings && summary.normalFindings.length > 0) {
    content.push({ text: 'Normal Findings', style: 'subheader' });
    summary.normalFindings.forEach(group => {
      content.push({ text: sanitizePdfText(group.category), bold: true, margin: [0, 5, 0, 5], color: '#27AE60' });
      content.push(buildNormalTable(group.entries, '#27AE60', '#EAFAF1'));
    });
  }

  // Disclaimer
  content.push({ text: '\n\n' }); // spacing before disclaimer
  content.push({
    margin: [0, 20, 0, 0],
    table: {
      widths: ['*'],
      body: [
        [
          {
            fillColor: '#FDF2E9',
            margin: [10, 10, 10, 10],
            border: [false, false, false, false],
            stack: [
              { text: 'MEDICAL DISCLAIMER', style: 'disclaimerLabel' },
              { text: summary.disclaimer || 'This report is generated by an automated system and may contain errors. It is NOT intended to be a substitute for professional medical advice, diagnosis, or treatment. Always seek the advice of your physician or other qualified health provider with any questions you may have regarding a medical condition or laboratory results.', style: 'disclaimerText' }
            ]
          }
        ]
      ]
    }
  });

  return content;
}

function buildMetadataSection(summary: ReportSummary): Content {
  const meta = summary.metadata;
  return {
    columns: [
      {
        width: '*',
        stack: [
          { text: [{ text: 'Patient Name: ', style: 'metaLabel' }, { text: sanitizePdfText(meta.patientName) || 'Unknown', style: 'metaValue' }] },
          { text: [{ text: 'Age: ', style: 'metaLabel' }, { text: sanitizePdfText(meta.patientAge ? meta.patientAge.toString() : 'Unknown'), style: 'metaValue' }] },
          { text: [{ text: 'Gender: ', style: 'metaLabel' }, { text: sanitizePdfText(meta.patientGender) || 'Unknown', style: 'metaValue' }] },
        ],
      },
      {
        width: '*',
        stack: [
          { text: [{ text: 'Report ID: ', style: 'metaLabel' }, { text: sanitizePdfText(meta.reportId) || 'N/A', style: 'metaValue' }] },
          { text: [{ text: 'Report Date: ', style: 'metaLabel' }, { text: sanitizePdfText(meta.reportDate) || 'Unknown', style: 'metaValue' }] },
          { text: [{ text: 'Lab Name: ', style: 'metaLabel' }, { text: sanitizePdfText(meta.labName) || 'Unknown', style: 'metaValue' }] },
        ],
      },
    ],
    columnGap: 20,
  };
}

function buildFindingsTable(findings: SummaryFinding[], headerColor: string, rowBgColor: string): Content {
  const tableBody: TableCell[][] = [
    [
      { text: 'Test Name', style: 'tableHeader', fillColor: headerColor },
      { text: 'Value', style: 'tableHeader', fillColor: headerColor },
      { text: 'Reference', style: 'tableHeader', fillColor: headerColor },
      { text: 'Interpretation', style: 'tableHeader', fillColor: headerColor },
    ],
  ];

  findings.forEach((finding, index) => {
    const bgColor = index % 2 === 0 ? rowBgColor : '#FFFFFF';
    
    let refStr = 'N/A';
    if (finding.referenceRange) {
      if (finding.referenceRange.text) {
        refStr = finding.referenceRange.text;
      } else if (finding.referenceRange.low !== undefined && finding.referenceRange.high !== undefined) {
        refStr = `${finding.referenceRange.low} - ${finding.referenceRange.high}`;
      } else if (finding.referenceRange.low !== undefined) {
        refStr = `> ${finding.referenceRange.low}`;
      } else if (finding.referenceRange.high !== undefined) {
        refStr = `< ${finding.referenceRange.high}`;
      }
    }

    const valStr = finding.unit ? `${finding.value} ${finding.unit}` : finding.value;

    tableBody.push([
      { text: sanitizePdfText(finding.testName), style: 'tableCell', fillColor: bgColor },
      { text: sanitizePdfText(valStr), style: 'tableCell', fillColor: bgColor, bold: true },
      { text: sanitizePdfText(refStr), style: 'tableCell', fillColor: bgColor },
      { text: sanitizePdfText(finding.interpretation || (finding.uncertaintyReason ? `Uncertain: ${finding.uncertaintyReason}` : '')), style: 'tableCell', fillColor: bgColor },
    ]);
  });

  return {
    table: {
      headerRows: 1,
      widths: ['30%', '15%', '15%', '40%'],
      body: tableBody,
    },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 15],
  };
}

function buildNormalTable(entries: NormalEntry[], headerColor: string, rowBgColor: string): Content {
  const tableBody: TableCell[][] = [
    [
      { text: 'Test Name', style: 'tableHeader', fillColor: headerColor },
      { text: 'Value', style: 'tableHeader', fillColor: headerColor },
      { text: 'Reference', style: 'tableHeader', fillColor: headerColor },
    ],
  ];

  entries.forEach((entry, index) => {
    const bgColor = index % 2 === 0 ? rowBgColor : '#FFFFFF';
    
    let refStr = 'N/A';
    if (entry.referenceRange) {
      if (entry.referenceRange.text) {
        refStr = entry.referenceRange.text;
      } else if (entry.referenceRange.low !== undefined && entry.referenceRange.high !== undefined) {
        refStr = `${entry.referenceRange.low} - ${entry.referenceRange.high}`;
      } else if (entry.referenceRange.low !== undefined) {
        refStr = `> ${entry.referenceRange.low}`;
      } else if (entry.referenceRange.high !== undefined) {
        refStr = `< ${entry.referenceRange.high}`;
      }
    }

    const valStr = entry.unit ? `${entry.value} ${entry.unit}` : entry.value;

    tableBody.push([
      { text: sanitizePdfText(entry.testName), style: 'tableCell', fillColor: bgColor },
      { text: sanitizePdfText(valStr), style: 'tableCell', fillColor: bgColor },
      { text: sanitizePdfText(refStr), style: 'tableCell', fillColor: bgColor },
    ]);
  });

  return {
    table: {
      headerRows: 1,
      widths: ['35%', '30%', '35%'],
      body: tableBody,
    },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 15],
  };
}
