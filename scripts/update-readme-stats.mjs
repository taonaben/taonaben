// scripts/update-readme-stats.mjs
//
// Pulls real stats (repo count, followers, contributions, streak) from
// GitHub's GraphQL API and rewrites the "stats" block inside README.md.
// No widget images — just numbers written straight into the JSON text.
//
// Requires: README.md to contain a `"stats": { ... },` object inside a
// fenced code block, as in the sample README. No HTML comment markers are
// used — those would render as literal text inside a code fence on GitHub,
// which ruins the "pure JSON" look. Instead the script locates the block
// by matching the "stats" key itself, so keep that key name as-is and keep
// the stats object flat (no nested braces) since the matching below stops
// at the first closing brace.
//
// Env vars (set by the workflow):
//   GH_TOKEN   - a token with read access (the default GITHUB_TOKEN works
//                for public profile data)
//   GH_LOGIN   - the GitHub username to fetch stats for

import { readFileSync, writeFileSync } from "node:fs";

const token = process.env.GH_TOKEN;
const login = process.env.GH_LOGIN;

if (!token || !login) {
  console.error("Missing GH_TOKEN or GH_LOGIN env vars.");
  process.exit(1);
}

const query = `
  query($login: String!) {
    user(login: $login) {
      followers { totalCount }
      following { totalCount }
      repositories(privacy: PUBLIC, ownerAffiliations: OWNER) { totalCount }
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }
`;

async function fetchStats() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { login } }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API responded ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data.user;
}

// Flatten the weeks/days grid into a single chronological array of
// { date, count } and compute current + longest streak from it.
function computeStreaks(calendar) {
  const days = calendar.weeks.flatMap((w) => w.contributionDays);

  let longest = 0;
  let running = 0;
  for (const day of days) {
    if (day.contributionCount > 0) {
      running += 1;
      longest = Math.max(longest, running);
    } else {
      running = 0;
    }
  }

  // Current streak: walk backwards from today until a zero day is hit.
  // (If today has 0 contributions yet, don't break the streak on today
  // specifically — start counting from the most recent day with activity.)
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) {
      current += 1;
    } else if (current > 0) {
      break;
    }
    // if current === 0 and today is 0, keep looking backwards one more day
  }

  return { current, longest };
}

function buildStatsBlock(user) {
  const { current, longest } = computeStreaks(
    user.contributionsCollection.contributionCalendar
  );

  const stats = {
    public_repos: user.repositories.totalCount,
    followers: user.followers.totalCount,
    following: user.following.totalCount,
    contributions_past_year:
      user.contributionsCollection.contributionCalendar.totalContributions,
    current_streak_days: current,
    longest_streak_days: longest,
    last_updated: new Date().toISOString().slice(0, 10),
  };

  // Indented to match the surrounding "stats": { ... } block in the README
  // (2-space indent per level, block sits 2 spaces in from the left margin).
  const lines = JSON.stringify(stats, null, 2).split("\n");
  const indented = lines
    .map((line, i) => (i === 0 ? line : "  " + line))
    .join("\n");
  return `"stats": ${indented},`;
}

async function main() {
  const user = await fetchStats();
  const statsBlock = buildStatsBlock(user);

  const readmePath = "README.md";
  const readme = readFileSync(readmePath, "utf8");

  // Matches `"stats": { ... },` — non-greedy up to the first closing
  // brace, which works as long as the stats object stays flat (no nested
  // objects/arrays). If you add a nested object back in, widen this regex.
  const statsRegex = /"stats":\s*\{[\s\S]*?\n\s*\},/;

  if (!statsRegex.test(readme)) {
    console.error(
      `Could not find a "stats": { ... }, block in README.md — see script header for setup.`
    );
    process.exit(1);
  }

  const updated = readme.replace(statsRegex, statsBlock);

  writeFileSync(readmePath, updated);
  console.log("README.md stats block updated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
