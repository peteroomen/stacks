export type Album = {
  id: string;
  artist: string;
  title: string;
  release_type: string;
  year: number | null;
  genre: string | null;
  genre_parent: string | null;
  listen_count: number;
  rating: number | null;
  comments: string | null;
  collection_status: string | null;
  cover_art_url: string | null;
  mbid: string | null;
  source: string;
  created_at: string;
};

export type AlbumFilters = {
  q?: string;
  parent?: string;      // genre_parent
  genre?: string;       // specific subgenre
  yearMin?: number;
  yearMax?: number;
  ratingMin?: number;
  ratingMax?: number;
  collection?: string;
  releaseType?: string;
  unratedOnly?: boolean;
  sort?: string;        // e.g. "rating.desc"
  page?: number;
  pageSize?: number;
};

export type Insight = {
  kind: "revisit_queue" | "blind_spots" | "recent_run" | "recommendations";
  payload: unknown;
  generated_at: string;
};
