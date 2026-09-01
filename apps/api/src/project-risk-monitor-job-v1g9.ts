import {
  prisma,
} from './db.js';

import {
  runProjectRiskMonitorReliablyV1g18,
} from './project-risk-monitor-reliability-v1g18.js';

async function main() {
  const result =
    await runProjectRiskMonitorReliablyV1g18();

  console.info(
    JSON.stringify({
      projectRiskMonitorV1g9:
        result.monitor
          ? 'PASS'
          : 'SKIPPED',

      projectRiskMonitorReliabilityV1g18:
        'PASS',

      ...result,
    }),
  );

  if (
    result.status ===
      'PARTIAL'
  ) {
    process.exitCode =
      1;
  }
}

main()
  .catch(
    (error) => {
      console.error(
        error,
      );

      process.exitCode =
        1;
    },
  )
  .finally(
    async () => {
      await prisma
        .$disconnect();
    },
  );
