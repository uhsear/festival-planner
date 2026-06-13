/** Shared types for the crew wrap poster, consumed by both web and mobile
 *  CrewWrapPoster components. Server shape from
 *  GET /ratings/crew-wrap/:crewId/:festivalId (the `wrap` field). */

export interface CrewWrapOverlapPair {
  aUserId: string;
  aName: string;
  bUserId: string;
  bName: string;
  shared: number;
  sharedSets: string[];
}

export interface CrewWrapSeenTogether {
  setId: string;
  artist: string | null;
  count: number;
}

export interface CrewWrapMemberSummary {
  userId: string;
  name: string;
  topSets: { setId: string; artist: string | null; rating: number }[];
}
