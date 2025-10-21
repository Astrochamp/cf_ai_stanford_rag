import 'dotenv/config';
import * as fs from 'fs';
import { fetchArticleContent } from './lib/fetch';
import { processArticleSectionDual } from './lib/preprocess';
import { ArticleID, ArticleSection, ProcessedChunk } from './lib/shared/types';


// fetches "What's New" RSS from SEP, compares with stored index, and upserts any new/changed articles
async function updateIndex() {
  const rssUrl = "https://plato.stanford.edu/rss/sep.xml";
}

// initial index population (long-running, stores state in DB to allow resumption)
async function populateIndex() {}

