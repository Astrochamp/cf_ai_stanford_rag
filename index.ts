import 'dotenv/config';
import * as fs from 'fs';
import { fetchArticleContent, fetchArticlesList } from './lib/fetch';
import { processArticleSectionDual } from './lib/preprocess';
import { ArticleID, ArticleSection, ProcessedChunk } from './lib/shared/types';


// initial index population (long-running, stores state in DB to allow resumption)
async function populateIndex() {
  const articleIDs: ArticleID[] = await fetchArticlesList();
  
}