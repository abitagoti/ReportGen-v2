ReportGen service stop fix

Extract these files into the root of the ReportGen source folder, preserving folder paths. Replace the matching files, then commit and push. The server closes active HTTP/proxy connections when stopping so the Windows service can shut down promptly. The installer stop hook runs on every install or repair.
