# TMDB API Integration Endpoints — Movientum

This document details the external API endpoints consumed from **The Movie Database (TMDB)** (`https://api.themoviedb.org/3`) to populate the Movientum catalog.

## Authentication & Headers

All requests require Bearer token authentication in the HTTP header:

```http
Authorization: Bearer <TMDB_READ_ACCESS_TOKEN>
accept: application/json
```

---

## 1. Movie Endpoints

### 1.1 Get Movie Details
* **Endpoint:** `GET /movie/{movie_id}`
* **Purpose:** Fetch detailed metadata for a single movie.
* **Query Parameters:**
  * `append_to_response`: `videos,credits,similar` (minimizes network roundtrips)
  * `language`: `en-US`

#### Sample Response JSON
```json
{
  "id": 550,
  "imdb_id": "tt0137523",
  "title": "Fight Club",
  "original_title": "Fight Club",
  "overview": "A ticking-time-bomb insomniac and a slippery soap salesman channel male aggression into a shocking new form of therapy...",
  "release_date": "1999-10-15",
  "runtime": 139,
  "budget": 63000000,
  "revenue": 100853753,
  "genres": [
    { "id": 18, "name": "Drama" }
  ],
  "poster_path": "/pB8BM7rnGgDc47VlDJ5h2Y7gi81.jpg",
  "backdrop_path": "/hZ3xJUj9Kty36WclGg2iRMA6e8u.jpg",
  "vote_average": 8.433,
  "vote_count": 28624,
  "popularity": 81.332,
  "credits": {
    "cast": [
      {
        "id": 287,
        "name": "Brad Pitt",
        "character": "Tyler Durden",
        "profile_path": "/ccDTs7p7h0o709nJM77567rj2IB.jpg",
        "order": 0
      }
    ],
    "crew": [
      {
        "id": 7467,
        "name": "David Fincher",
        "job": "Director",
        "profile_path": "/r7qiB32E7CFRm1XyA2wVw4X17wY.jpg"
      }
    ]
  },
  "videos": {
    "results": [
      {
        "key": "O-b2VfB7rIE",
        "site": "YouTube",
        "type": "Trailer",
        "official": true
      }
    ]
  },
  "similar": {
    "results": [
      {
        "id": 110,
        "title": "Three Colors: Red",
        "poster_path": "/aBz61QoT3oVjG30yGg1N35d8eG8.jpg"
      }
    ]
  }
}
```

---

### 1.2 Search Movies
* **Endpoint:** `GET /search/movie`
* **Purpose:** Query movies by title.
* **Query Parameters:**
  * `query`: URL-encoded search string (e.g., `Inception`)
  * `page`: `1`
  * `include_adult`: `false`

#### Sample Response JSON
```json
{
  "page": 1,
  "results": [
    {
      "id": 27205,
      "title": "Inception",
      "overview": "Cobb, a skilled thief who commits corporate espionage by infiltrating the subconscious of his targets...",
      "release_date": "2010-07-15",
      "genre_ids": [28, 878, 12],
      "poster_path": "/edv5CZv0j59nZ1FSszj755D9JmF.jpg",
      "backdrop_path": "/s3T38Rhxi5ouv12nEg51P2P1Sj5.jpg",
      "vote_average": 8.364,
      "popularity": 124.815
    }
  ],
  "total_pages": 1,
  "total_results": 1
}
```

---

### 1.3 Get Popular / Top Rated Movies
* **Endpoints:** 
  * `GET /movie/popular` (Trending popularity weight)
  * `GET /movie/top_rated` (Highest votes weight)
* **Query Parameters:**
  * `page`: Integer (default `1`, max `500`)
  * `language`: `en-US`

#### Sample Response JSON
```json
{
  "page": 1,
  "results": [
    {
      "id": 1022789,
      "title": "Inside Out 2",
      "overview": "Teenager Riley's mind headquarters is undergoing a sudden demolition to make room for something entirely unexpected...",
      "release_date": "2024-06-11",
      "poster_path": "/vpnVM9B6NMmQjVoZg6oFWo2TYzs.jpg",
      "backdrop_path": "/stKG8fbLwWWkP71v90SI7RIGI8t.jpg",
      "vote_average": 7.6,
      "popularity": 4521.82
    }
  ],
  "total_pages": 120,
  "total_results": 2400
}
```

---

## 2. TV Show (Series) Endpoints

### 2.1 Get TV Show Details
* **Endpoint:** `GET /tv/{series_id}`
* **Purpose:** Fetch metadata, seasons info, and creators for a TV show.
* **Query Parameters:**
  * `append_to_response`: `videos,credits,similar`
  * `language`: `en-US`

#### Sample Response JSON
```json
{
  "id": 1399,
  "name": "Game of Thrones",
  "original_name": "Game of Thrones",
  "overview": "Seven noble families fight for control of the mythical land of Westeros...",
  "first_air_date": "2011-04-17",
  "last_air_date": "2019-05-19",
  "number_of_seasons": 8,
  "number_of_episodes": 73,
  "genres": [
    { "id": 10765, "name": "Sci-Fi & Fantasy" },
    { "id": 18, "name": "Drama" }
  ],
  "poster_path": "/1XS1u42tRelYcn4XGbZ1hbVIJ0d.jpg",
  "backdrop_path": "/2omb0m24i7v6Rxns52535Z8t8rI.jpg",
  "vote_average": 8.442,
  "vote_count": 23415,
  "popularity": 320.12,
  "seasons": [
    {
      "id": 3624,
      "name": "Season 1",
      "episode_count": 10,
      "season_number": 1,
      "poster_path": "/zwaj07L5z4tpgGlRvgjCQOWPaNp.jpg"
    }
  ],
  "credits": {
    "cast": [
      {
        "id": 22970,
        "name": "Emilia Clarke",
        "character": "Daenerys Targaryen",
        "profile_path": "/ohlAI577qIL63T2f8tLqfCz6iTz.jpg"
      }
    ],
    "crew": [
      {
        "id": 9813,
        "name": "David Benioff",
        "job": "Executive Producer",
        "profile_path": "/1y17d4K3S56vEclgX247d5p5xP6.jpg"
      }
    ]
  }
}
```

---

### 2.2 Search TV Shows
* **Endpoint:** `GET /search/tv`
* **Purpose:** Query television series by name.
* **Query Parameters:**
  * `query`: URL-encoded string (e.g., `Breaking Bad`)
  * `page`: `1`

#### Sample Response JSON
```json
{
  "page": 1,
  "results": [
    {
      "id": 1396,
      "name": "Breaking Bad",
      "overview": "Walter White, a New Mexico chemistry teacher, diagnosed with Stage III cancer...",
      "first_air_date": "2008-01-20",
      "genre_ids": [18, 80],
      "poster_path": "/ztkUQVk6979163fFUGOC2d2F56Q.jpg",
      "backdrop_path": "/9fa5tCH1477JCRvjrs60auAs95l.jpg",
      "vote_average": 8.9,
      "popularity": 284.14
    }
  ]
}
```

---

## 3. Shared Catalog Endpoints

### 3.1 Get Genre Lists
These mappings translate TMDB genre IDs into readable strings on frontend client and database.
* **Movie Genres:** `GET /genre/movie/list`
* **TV Genres:** `GET /genre/tv/list`

#### Sample Response JSON
```json
{
  "genres": [
    { "id": 28, "name": "Action" },
    { "id": 12, "name": "Adventure" },
    { "id": 35, "name": "Comedy" },
    { "id": 80, "name": "Crime" }
  ]
}
```

---

### 3.2 Get Trending Media
* **Endpoint:** `GET /trending/{media_type}/{time_window}`
* **Path Parameters:**
  * `media_type`: `all` | `movie` | `tv` | `person`
  * `time_window`: `day` | `week`

#### Sample Response JSON
```json
{
  "page": 1,
  "results": [
    {
      "id": 823464,
      "title": "Godzilla x Kong: The New Empire",
      "media_type": "movie",
      "poster_path": "/b4AY5gHNnZgcwzz596R2IoKF565.jpg",
      "vote_average": 7.21,
      "popularity": 1925.4
    }
  ]
}
```

---

## 4. Image URL Schema

TMDB returns partial paths (e.g. `/pB8BM7rnGgDc47VlDJ5h2Y7gi81.jpg`).  
To display images, concatenate with TMDB base image URL and size:

`https://image.tmdb.org/t/p/{size}/{path}`

### Common Sizes
* **Posters:** `w342`, `w500`, `original`
* **Backdrops:** `w780`, `w1280`, `original`
* **Profiles (Cast):** `w185`, `h632`
