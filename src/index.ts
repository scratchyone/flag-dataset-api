/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { v4 as uuidv4 } from 'uuid';

export interface Env {
  DB: D1Database;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS, POST',
      'Access-Control-Allow-Headers': '*',
    };
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '');
    let params = new URLSearchParams(url.search);
    if (request.method.toLowerCase() === 'options') {
      return new Response('ok', {
        headers: corsHeaders,
      });
    }
    if (request.method === 'GET' && pathname === '') {
      const count = await env.DB.prepare(
        `SELECT count(*) AS count FROM Flags;`
      ).first('count');
      return new Response(`There are ${count} flags in the D1 database!`, {
        headers: corsHeaders,
      });
    } else if (request.method === 'GET' && pathname === '/flags') {
      let offset = params.get('offset');
      let limit = params.get('limit');
      if (offset === null) offset = '0';
      if (limit === null) limit = '10';
      const results = await env.DB.prepare(
        `SELECT * FROM (SELECT FlagID, Timestamp FROM Flags ORDER BY Timestamp DESC LIMIT ? OFFSET ?) AS Flag INNER JOIN Colors AS Color ON Flag.FlagID = Color.FlagID ORDER BY Flag.Timestamp DESC, Color.FlagID ASC, Color.N ASC;`
      )
        .bind(limit, offset)
        .all();
      console.log(results.results);
      return new Response(
        JSON.stringify({
          flags: Object.values(
            (results.results as any).reduce((a: any, c: any) => {
              return {
                ...a,
                [c.FlagID]: {
                  id: c.FlagID,
                  colors: [...(a[c.FlagID] || { colors: [] }).colors, c.Color],
                },
              };
            }, {})
          ),
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: await env.DB.prepare(
            `SELECT count(*) AS count FROM Flags;`
          ).first('count'),
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      );
    } else if (request.method === 'POST' && pathname === '/flags') {
      const body: Array<string> = await request.json();
      if (body.filter((v) => v.match(/[0-9A-Fa-f]{6}/g)).length === 0) {
        return new Response('Event logged', {
          status: 400,
          headers: corsHeaders,
        });
      }
      let id = uuidv4();
      let flag = await env.DB.prepare(
        'INSERT INTO Flags (FlagID, IP, Timestamp) VALUES (?, ?, ?);'
      )
        .bind(id, request.headers.get('CF-Connecting-IP'), Date.now())
        .run();
      console.log(flag.lastRowId);
      await env.DB.batch(
        body.map((v, i) =>
          env.DB.prepare(
            'INSERT INTO Colors (FlagID, Color, N) VALUES (?, ?, ?);'
          ).bind(id, v, i)
        )
      );
      return new Response('Event logged', {
        status: 201,
        headers: corsHeaders,
      });
    }
    return new Response('Method Not Allowed', {
      status: 405,
      headers: corsHeaders,
    });
  },
};
