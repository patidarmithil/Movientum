INFO:     Application startup complete.
INFO:     127.0.0.1:59314 - "GET /api/v1/auth/me HTTP/1.1" 200 OK
INFO:     127.0.0.1:59312 - "GET /api/v1/person/1691327 HTTP/1.1" 200 OK
INFO:     127.0.0.1:59314 - "GET /api/v1/auth/me HTTP/1.1" 200 OK
INFO:     127.0.0.1:59312 - "GET /api/v1/person/1691327 HTTP/1.1" 200 OK
TMDB network error (ConnectError) for /person/1691327/combined_credits. Attempt 1/3
2026-05-29 15:48:26,534 INFO sqlalchemy.engine.Engine BEGIN (implicit)
2026-05-29 15:48:26,535 INFO sqlalchemy.engine.Engine
            DELETE FROM movies
            WHERE popularity < 5.0
              AND id NOT IN (
                SELECT DISTINCT movie_id FROM ratings
                UNION
                SELECT DISTINCT movie_id FROM watch_history
                UNION
                SELECT DISTINCT movie_id FROM watchlist
              )
              AND fetched_at < NOW() - INTERVAL '30 days';

2026-05-29 15:48:26,536 INFO sqlalchemy.engine.Engine [generated in 0.00114s] ()
TMDB network error (ConnectError) for /person/1691327/combined_credits. Attempt 2/3
2026-05-29 15:48:26,634 INFO sqlalchemy.engine.Engine COMMIT
INFO:     127.0.0.1:59313 - "GET /api/v1/person/1691327/credits HTTP/1.1" 200 OK
INFO:     127.0.0.1:59312 - "GET /api/v1/person/1691327/credits HTTP/1.1" 200 OK
