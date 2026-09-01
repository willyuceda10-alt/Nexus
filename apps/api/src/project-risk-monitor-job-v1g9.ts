import { prisma } from './db.js';

import {
  runProjectRiskMonitorV1g9,
} from './project-risk-monitor-v1g9.js';

async function main() {
  const result =
    await runProjectRiskMonitorV1g9();

  console.info(
    JSON.stringify({
      projectRiskMonitorV1g9: 'PASS',
      ...result,
    }),
  );

  if (result.failedProjects > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
