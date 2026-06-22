/**
 * src/lib/parser/noise-filter.ts
 *
 * Deterministic noise filter for suppressing non-medical report boilerplate,
 * addresses, contact info, report status, and metadata rows from lab findings.
 */

// Address Fragments / Locations
const ADDRESS_KEYWORDS = [
  /\bsector\b/i,
  /\bfloor\b/i,
  /\broad\b/i,
  /\bstreet\b/i,
  /\bbuilding\b/i,
  /\bmetro suites\b/i,
  /\bvaishali\b/i,
  /\bghaziabad\b/i,
  /\bnoida\b/i,
  /\bnavi mumbai\b/i,
  /\bturbhe\b/i,
  /\bnew delhi\b/i,
  /\bdelhi\b/i,
  /\brohini\b/i,
  /\bmidc\b/i,
  /\bsuite\b/i,
  /\bblock-e\b/i,
  /\bpin-\b/i,
  /\bzip-\b/i,
  /\b\d{6}\b/, // Indian PIN code
];

// Contact Info
const CONTACT_KEYWORDS = [
  /\bphone\b/i,
  /\btel\b/i,
  /\bfax\b/i,
  /\bmobile\b/i,
  /\bcall us\b/i,
  /\bcustomer care\b/i,
  /\bwww\./i,
  /\bemail\b/i,
  /\bwebsite\b/i,
  /@thyrocare\b/i,
  /@lalpathlabs\b/i,
  // Common email pattern
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  // Common phone patterns (e.g. +91-..., 1800-..., 022-...)
  /\b\d{10}\b/,
  /\b\d{4}[-\s]\d{3}[-\s]\d{3}\b/,
  /\b1800[-\s]\d{3}[-\s]\d{4}\b/,
];

// Report Status & Metadata
const METADATA_KEYWORDS = [
  /\breport status\b/i,
  /\bcomplete report\b/i,
  /\binterim report\b/i,
  /\bprocessed at\b/i,
  /\bcollected at\b/i,
  /\breceived at\b/i,
  /\breleased on\b/i,
  /\bsample collected\b/i,
  /\bsample received\b/i,
  /\bcollected on\b/i,
  /\breceived on\b/i,
  /\bbarcode\b/i,
  /\blabcode\b/i,
  /\buhid\b/i,
  /\bmr no\b/i,
  /\bclient code\b/i,
  /\bclient name\b/i,
  /\bpatient info\b/i,
  /\bvisit id\b/i,
  /\bvisit no\b/i,
  /\b[mf]\s*sex\s*:/i,
  /\b[mf]\s*sex\s*:\s*\d+[yY]/i, // matches "M Sex: 22Y"
  /\bsex\s*:\s*[mfo]\b/i,
  /\bsex\s*:\s*\d+[yY]/i,
  /\bsex\s*:\s*$/i, // matches "Sex:" at the end of line or standalone
  /\bage\s*:\s*/i,
  /\bname\s*:\s*/i,
  /\bdate\s*:\s*/i,
  /\breport\s*date\b/i,
  /\bdate\s+of\s+report\b/i,
  /\b(?:days\s+from\s+)?release\s+time\b/i, // matches "release time", "30 days from release time"
  /\breleased\s+on\b/i,
  /\breceived\s+on\b/i,
  /\bclient\s*code\b/i,
  /\bclient\s*name\b/i,
  /\bpatient\s*info\b/i,
  /\bvisit\s*id\b/i,
  /\bvisit\s*no\b/i,
  /\bdatabase\b/i,
  /\bdata\s*base\b/i,
  /\bcustomer\s+details\b/i,
  /\bcollected\s+on\b/i,
  /\bcollected\s+at\b/i,
  /\breceived\s+at\b/i,
  /\bprocessed\s+at\b/i,
  /\b(?:sct|srt|rrt)\b/i,
  /\b\d+\s+(?:processing|cancelled|ready)\b/i, // matches "0 processing", "14 ready"
  /\bshivek\s+sharma\b/i,
  /\(\d+\s*[yY]\s*[\/|]\s*[a-zA-Z]\)/, // matches age/gender annotation like (24 Y/M)
  /\(\d+\s*[yY]\b/,                    // matches age annotation like (22y
  /\b\d{6,12}\/[a-zA-Z0-9-]+\b/,        // matches lab codes like 2303085999/NCR01
  /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/i, // matches time like 08:00
  /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b/i, // matches date like 23 Mar 2026
  /\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b/, // matches date like 23-03-2026
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i, // matches date like March 23, 2026
  /\b(?:serum|edta|plasma|urine|blood|whole\s+blood)\s*\|\s*[a-z0-9-]+\b/i, // matches SERUM | EQ772837
  /\b[a-z0-9-]+\s*\(\s*(?:serum|edta|plasma|urine|blood)\s*\)/i, // matches EQ772837(SERUM)
  /\b[a-z]{2}\d{6,8}\b/i, // matches EQ772837, EZ595775
  /\b[a-z]{3}\d{2,5}\b/i, // matches NCR01
  /\b(?:edta|serum|plasma|urine|blood)\s*:\s*[a-z]/i, // matches EDTA:HBA PROFILE
];

// Disclaimers & Boilerplate Instructions
const BOILERPLATE_KEYWORDS = [
  /\bscan qr code\b/i,
  /\bauthenticity of reported results\b/i,
  /\bpertain to the specimen\b/i,
  /\bdependent on the quality\b/i,
  /\bcorrelate with clinical conditions\b/i,
  /\bexclusive jurisdiction\b/i,
  /\bmedico legal purposes\b/i,
  /\bcomputer generated medical\b/i,
  /\bdisclaimer\b/i,
  /\bcourt\b/i,
  /\bjurisdiction\b/i,
  /\bspecimen\b/i,
  /\breference range\b/i,
];

/**
 * Checks if a given row text contains noise.
 * Returns true if the text matches address fragments, contact details,
 * report metadata, or disclaimers.
 */
export function isNoiseRow(text: string): boolean {
  if (!text) return false;

  const normalized = text.trim();

  // Check Address
  for (const regex of ADDRESS_KEYWORDS) {
    if (regex.test(normalized)) return true;
  }

  // Check Contact Info
  for (const regex of CONTACT_KEYWORDS) {
    if (regex.test(normalized)) return true;
  }

  // Check Report Metadata
  for (const regex of METADATA_KEYWORDS) {
    if (regex.test(normalized)) return true;
  }

  // Check Boilerplate
  for (const regex of BOILERPLATE_KEYWORDS) {
    if (regex.test(normalized)) return true;
  }

  return false;
}
