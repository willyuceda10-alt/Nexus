import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';

import {
  basename,
  join,
} from 'node:path';

const distDir =
  new URL(
    '../dist/',
    import.meta.url,
  );

const assetsDir =
  new URL(
    '../dist/assets/',
    import.meta.url,
  );

const indexPath =
  new URL(
    '../dist/index.html',
    import.meta.url,
  );

const MAX_ENTRY_BYTES =
  500 * 1024;

const MAX_ASYNC_CHUNK_BYTES =
  300 * 1024;

function fail(
  message,
) {
  console.error(
    message,
  );

  process.exitCode =
    1;
}

if (
  !existsSync(
    distDir,
  ) ||
  !existsSync(
    assetsDir,
  ) ||
  !existsSync(
    indexPath,
  )
) {
  fail(
    'F1_BUNDLE_BUDGET: dist build is missing.',
  );
}
else {
  const html =
    readFileSync(
      indexPath,
      'utf8',
    );

  const scriptMatch =
    html.match(
      /<script[^>]+src="([^"]+\.js)"/,
    );

  if (!scriptMatch) {
    fail(
      'F1_BUNDLE_BUDGET: entry script was not found in dist/index.html.',
    );
  }
  else {
    const relativeEntry =
      scriptMatch[1]
        .replace(
          /^\//,
          '',
        );

    const entryPath =
      new URL(
        `../dist/${relativeEntry}`,
        import.meta.url,
      );

    if (
      !existsSync(
        entryPath,
      )
    ) {
      fail(
        `F1_BUNDLE_BUDGET: entry file does not exist: ${relativeEntry}`,
      );
    }
    else {
      const entryBytes =
        statSync(
          entryPath,
        ).size;

      const jsFiles =
        readdirSync(
          assetsDir,
        )
          .filter(
            (name) =>
              name.endsWith(
                '.js',
              ),
          )
          .map(
            (name) => {
              const file =
                join(
                  assetsDir.pathname,
                  name,
                );

              return {
                name:
                  basename(
                    name,
                  ),

                bytes:
                  statSync(
                    file,
                  ).size,
              };
            },
          )
          .sort(
            (
              left,
              right,
            ) =>
              right.bytes -
              left.bytes,
          );

      const oversizedAsync =
        jsFiles.filter(
          (item) =>
            item.name !==
              basename(
                entryPath.pathname,
              ) &&
            !item.name.startsWith(
              'vendor-react-',
            ) &&
            item.bytes >
              MAX_ASYNC_CHUNK_BYTES,
        );

      console.log(
        JSON.stringify(
          {
            webBundleBudgetF1:
              entryBytes <=
                MAX_ENTRY_BYTES &&
              oversizedAsync.length ===
                0
                ? 'PASS'
                : 'FAIL',

            entryFile:
              basename(
                entryPath.pathname,
              ),

            entryKb:
              Number(
                (
                  entryBytes /
                  1024
                ).toFixed(
                  2,
                ),
              ),

            entryBudgetKb:
              MAX_ENTRY_BYTES /
              1024,

            jsChunkCount:
              jsFiles.length,

            largestChunkKb:
              Number(
                (
                  (
                    jsFiles[0]
                      ?.bytes ??
                    0
                  ) /
                  1024
                ).toFixed(
                  2,
                ),
              ),

            oversizedAsyncChunks:
              oversizedAsync.map(
                (item) => ({
                  name:
                    item.name,

                  kb:
                    Number(
                      (
                        item.bytes /
                        1024
                      ).toFixed(
                        2,
                      ),
                    ),
                }),
              ),
          },
          null,
          2,
        ),
      );

      if (
        entryBytes >
        MAX_ENTRY_BYTES
      ) {
        fail(
          `F1_BUNDLE_BUDGET: entry chunk exceeds 500 KB (${(
            entryBytes /
            1024
          ).toFixed(
            2,
          )} KB).`,
        );
      }

      if (
        oversizedAsync.length >
        0
      ) {
        fail(
          'F1_BUNDLE_BUDGET: an async application chunk exceeds 300 KB.',
        );
      }
    }
  }
}
