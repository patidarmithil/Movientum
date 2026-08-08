/**
 * loaderPosters.js — static fallback poster paths for ColdStartLoader.
 *
 * Used ONLY when localStorage has no cached posters (i.e. the visitor's very first
 * page view). These are raw TMDB `poster_path` values; the CDN base is prepended at
 * render time. They intentionally do NOT hit the Movientum backend — the loader is
 * shown precisely when that backend is cold.
 *
 * Sourced from TMDB `/movie/top_rated` (Hollywood) and `/discover/movie` filtered by
 * original_language (hi/ja/ko, sorted by vote_count) so the wall reflects Movientum's
 * catalogue breadth, then verified to resolve at https://image.tmdb.org/t/p/w185{path}.
 */
export const FALLBACK_POSTERS = Object.freeze([
  '/3sgnSfNT27Bx5O5ukr7B26mhEQq.jpg',
  '/j0CIVzeR7hRAPBPGR54qDZoOQpp.jpg',
  '/tHhxWxge06goXU6ZQH1hj7vK8Hd.jpg',
  '/9cqNxx0GxF0bflZmeSMuL5tnGzr.jpg',
  '/zm0KAbOjlt9eR5y7vDiL2dEOwMl.jpg',
  '/3bhkrj58Vtu7enYsRolD1fZdja1.jpg',
  '/yihdXomYb5kTeSivtFndMy5iDmf.jpg',
  '/fWVSwgjpT2D78VUh6X8UBd2rorW.jpg',
  '/iGCtYxfuvXfy0BD5m6p7vKuPOxS.jpg',
  '/ecBRkXerAZqRRUfR8Lt3L3Dh6J5.jpg',
  '/sF1U4EUQS8YHUYjNl3pMGNIQyr0.jpg',
  '/ppd84D2i9W8jXmsyInGyihiSyqz.jpg',
  '/vQWk5YBFWF4bZaofAbv0tShwBvQ.jpg',
  '/icOZpnGuH9YrEaW3wrw5GJaXGih.jpg',
  '/9HcEqn3D4J6b2Z0jK54id9nA0fr.jpg',
  '/bX2xnavhMYjWDoZp1VM6VnU1xwe.jpg',
  '/Cw4hIUIAmSYfK9QfaUW5igp9La.jpg',
  '/6PQJsmuvSMZQMmlJfTpjIkrizUh.jpg',
  '/9OkCLM73MIU2CrKZbqiT8Ln1wY2.jpg',
  '/lOMGc8bnSwQhS4XyE1S99uH8NXf.jpg',
  '/lfRkUr7DYdHldAqi3PwdQGBRBPM.jpg',
  '/66A9MqXOyVFCssoloscw79z8Tew.jpg',
  '/5Y36lCiNyyV71mjq6LavgiggbhT.jpg',
  '/puHRt6Raovm5ujGCdwLWvRv4NHU.jpg',
  '/cJRPOLEexI7qp2DKtFfCh7YaaUG.jpg',
  '/z2x2Y4tncefsIU7h82gmUM5vnBJ.jpg',
  '/jSOiz1h97i3qwjZJXY8SeLvjPsl.jpg',
  '/yNX9lFRAFeNLNRIXdqZK9gYrYKa.jpg',
  '/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg',
  '/q719jXXEzOoYaps6babgKnONONX.jpg',
  '/13kOl2v0nD2OLbVSHnHk8GUFEhO.jpg',
  '/cMYCDADoLKLbB83g4WnJegaZimC.jpg',
  '/rtGDOeG9LzoerkDGZF9dnVeLppL.jpg',
  '/k9tv1rXZbOhH7eiCk378x61kNQ1.jpg',
  '/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg',
  '/kw6YQudA0TMcNmGUGy5XIw7zbnV.jpg',
  '/pWDtjs568ZfOTMbURQBYuT4Qxka.jpg',
  '/vNVFt6dtcqnI7hqa6LFBUibuFiw.jpg',
  '/jcgUjx1QcupGzjntTVlnQ15lHqy.jpg',
  '/dLlH4aNHdnmf62umnInL8xPlPzw.jpg',
])
