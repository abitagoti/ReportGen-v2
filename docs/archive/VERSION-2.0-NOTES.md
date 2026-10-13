# ReportGen 2.0

This is the second working version of the generic ReportGen build.

- Product version: 2.0.0
- Generic company/business placeholders
- Version-scoped application data directory: `%APPDATA%\ReportGen-v2`
- Targeted uninstall script: `uninstall-reportgen-v2-complete.bat`
- Development desktop startup uses the system Node runtime to avoid native-module ABI conflicts between Node.js and Electron.

Run:

```bash
npm install
npm run start:desktop
```

### Owner report chart update
- Business sales contribution now renders all businesses with sales instead of limiting the chart to the top 8.
- Server-generated report HTML contribution chart also includes all businesses.
