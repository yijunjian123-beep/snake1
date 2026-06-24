import assert from "node:assert/strict";
import test from "node:test";

import {
  getBlackHoleSpawnBlockedCells,
  getBlackHoleSpawnDangerZones,
  getStarAttractorCells,
  getStarBeastCells,
  getStarCoreCells,
} from "../src/game/spawnSelectors.ts";
import type { StarAttractor, StarBeast, StarCore } from "../src/game/types.ts";

test("spawn selectors derive shared spawn cells without mutating source state", () => {
  const starCores: StarCore[] = [
    { id: 1, x: 4.8, y: 9.2, vx: 0, vy: 0, spawnTime: 0, magnetDelayMs: 0, magnetRadius: 0, lifetimeMs: 0, value: 1, source: "regular" },
  ];
  const starAttractors: StarAttractor[] = [{ id: 2, cell: { column: 6, row: 7 }, spawnTime: 0, seed: 1 }];
  const starBeasts: StarBeast[] = [{ id: 3, alive: true, body: [{ column: 1, row: 2 }, { column: 2, row: 2 }], dir: "right", length: 2, state: "patrol", moveTimer: 0, aiDecisionCooldown: 0, turnCommitTicks: 0, spawnGraceTime: 0, coreScanStepCount: 0, nextCoreHuntAt: 0, coreHuntUntil: 0, nextAttackAt: 0, attackUntil: 0, speedFactor: 1, aggroRadius: 1, loseAggroRadius: 2 }];

  assert.deepEqual(getStarCoreCells(starCores), [{ column: 4, row: 9 }]);
  assert.deepEqual(getStarAttractorCells(starAttractors, true), [{ column: 6, row: 7 }]);
  assert.deepEqual(getStarBeastCells(starBeasts), [{ column: 1, row: 2 }, { column: 2, row: 2 }]);

  const blockedCells = getBlackHoleSpawnBlockedCells({
    starBeasts,
    starAttractors,
    starCores,
    includeStarAttractors: true,
    extraBlockedCells: [{ column: 9, row: 9 }],
  });

  assert.deepEqual(blockedCells, [
    { column: 1, row: 2 },
    { column: 2, row: 2 },
    { column: 6, row: 7 },
    { column: 4, row: 9 },
    { column: 9, row: 9 },
  ]);

  const dangerZones = getBlackHoleSpawnDangerZones({
    starBeasts,
    birthCell: { column: 8, row: 8 },
  });

  assert.equal(dangerZones[0]?.radius, 3);
  assert.deepEqual(dangerZones[0]?.center, { column: 1, row: 2 });
});
