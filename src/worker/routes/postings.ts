import { Hono } from 'hono';
import { z } from 'zod';
import { readPosting } from '../posting';
import { ApiError, body, type AppEnv } from './util';

export const postings = new Hono<AppEnv>();

/** Reads a job posting from its link (read_posting): the job board's data, the page's, or a browser. */
postings.post('/postings/read', async (c) => {
  const { url } = await body(c, z.object({ url: z.string().trim().min(1).max(2000) }));
  try {
    return c.json(await readPosting(c.env, url));
  } catch (e) {
    throw new ApiError(400, 'unreadable', (e as Error).message);
  }
});
