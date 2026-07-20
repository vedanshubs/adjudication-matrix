// Shared domain types for the adjudication core.

export type Severity = 'Felony' | 'Misdemeanor' | 'Infraction' | 'Unknown';

export type CategoryType = 'Criminal' | 'Administrative';

/** A v5 offense category (from Criminal_Category_Mapping_v5). */
export interface Category {
  code: string; // e.g. "DRG"
  name: string; // e.g. "Drug Offenses"
  type: CategoryType;
  subcategories: string[];
}

export interface Taxonomy {
  builtAt: string;
  source: string;
  categories: Category[];
}

/** One knowledge-base row: an official offense mapped to the v5 taxonomy. */
export interface KBEntry {
  state: string; // WI | AR | TN | IL
  category: string; // v5 category name
  subcategory: string;
  severity: Severity;
  description: string; // official offense description
  statuteTitle: string;
  statuteNumber: string; // raw, as written in the source
  altCitations: string[]; // alternate code spellings (for the (state, code) index)
}

export interface KnowledgeBase {
  builtAt: string;
  sources: string[];
  entries: KBEntry[];
}

/**
 * A labeled anchor used by Tier 3 (keyword) and the AI tier (vector index).
 * Sources: the v5 taxonomy (subcategory names / offense examples) AND the state law books'
 * official offense descriptions — the latter is what the architecture calls the
 * "vector index of the descriptions", and is far richer + state-specific.
 */
export interface Anchor {
  phrase: string;
  category: string;
  subcategory: string;
  source: 'example' | 'subcategory' | 'kb';
  state?: string; // set for KB-sourced anchors; enables per-state filtering at scale
}

export interface AnchorSet {
  builtAt: string;
  source: string;
  anchors: Anchor[];
}
