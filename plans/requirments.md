# News System Implementation Requirements

To proceed with implementing the News System (`plans/news_system.md`), I need the following information/resources from you:

## 1. External API Keys
* **NewsAPI Key:** Please register at [NewsAPI](https://newsapi.org/) and provide a free tier API key. I will add this to our `.env` as `NEWS_API_KEY`.

*(Note: We already have the TMDB API key configured in our project, so I don't need that one.)*

## 2. Technical Decisions
* **1.NewsAPI Rate Limits:** The free tier gives us 100 requests/day. The plan suggests fetching global news every 2 hours (12 reqs/day), leaving 88 requests for movie-specific on-demand news. Do you approve this rate limit strategy?
* **2.Content Tagging:** The plan mentions tagging articles (extracting movie titles and genres). Do you want to start with simple keyword matching (easier/faster) or do you want me to set up a small NLP model like spaCy immediately?
* **3.Article Retention:** Do you want me to implement the auto-expiration (archiving articles older than 7 days) right away, or should we save that for a future enhancement once the base system works?

Please reply with the API key and your preferences on the technical decisions, and we'll start the implementation!
