// Mock candidates for the walkthrough. Every charge uses a real KB description
// (verified to map) so the demo is honest end-to-end. Thresholds use the default
// mock ruleset: high-risk categories = 1 within any window; medium = 2 within 7y.
import type { Charge } from './matrix.ts';

export interface Candidate {
  id: string;
  name: string;
  note: string;
  charges: Charge[];
}

const c = (description: string, over: Partial<Charge> = {}): Charge => ({
  description,
  disposition: 'Convicted',
  yearsAgo: 2,
  ...over,
});

export const candidates: Candidate[] = [
  {
    id: 'reed',
    name: 'Marcus Reed',
    note: 'repeat drug — duplicate row folded, then breach',
    charges: [
      c('Possession of Controlled Substance', { state: 'TN', severity: 'Felony', yearsAgo: 1 }),
      c('Possession of Controlled Substance', { state: 'TN', severity: 'Felony', yearsAgo: 1 }), // duplicate
      c('Possession of Controlled Substance', { state: 'TN', severity: 'Felony', yearsAgo: 6 }),
    ],
  },
  {
    id: 'whitfield',
    name: 'Dana Whitfield',
    note: 'single violent felony — high-risk, never ages out',
    charges: [c('Capital Murder', { severity: 'Felony', yearsAgo: 11 })],
  },
  {
    id: 'nair',
    name: 'Priya Nair',
    note: 'DUI pattern reaching the threshold',
    charges: [
      c('DWI', { severity: 'Misdemeanor', yearsAgo: 2 }),
      c('DWI', { severity: 'Misdemeanor', yearsAgo: 4 }),
    ],
  },
  {
    id: 'pierce',
    name: 'Darnell Pierce',
    note: 'multi-category — drug AND firearms both breach',
    charges: [
      c('Possession of Controlled Substance', { severity: 'Felony', yearsAgo: 1 }),
      c('Possession of Controlled Substance', { severity: 'Felony', yearsAgo: 2 }),
      c('Possession of Firearm by Felon', { severity: 'Felony', yearsAgo: 2 }),
    ],
  },
  {
    id: 'flores',
    name: 'Bianca Flores',
    note: 'dismissed / acquitted — correctly not counted',
    charges: [
      c('Battery in the First Degree', { disposition: 'Dismissed', severity: 'Felony', yearsAgo: 2 }),
      c('Robbery', { disposition: 'Acquitted', severity: 'Felony', yearsAgo: 3 }),
    ],
  },
  {
    id: 'marsh',
    name: 'Sophia Marsh',
    note: 'pending case — held for review',
    charges: [
      c('Fraudulent Use of a Credit Card', { disposition: 'Pending', severity: 'Felony', yearsAgo: 0 }),
      c('Theft of Property – First Degree ($25,000 or more)', { severity: 'Felony', yearsAgo: 5 }),
    ],
  },
  {
    id: 'kim',
    name: 'Sarah Kim',
    note: 'old conviction — ages out of the window',
    charges: [c('Knowingly damaging any property of another without their consent', { severity: 'Misdemeanor', yearsAgo: 12 })],
  },
  {
    id: 'coleman',
    name: 'Andre Coleman',
    note: 'clean — one minor charge under threshold',
    charges: [c('Unlawful Assembly', { severity: 'Misdemeanor', yearsAgo: 2 })],
  },
];
