const noUndefinedVariables = { "no-undef": "error" };

export default [
  {
    ignores: [
      "vendor/ical.js/**/*",
      "!vendor/ical.js/{date-only-rule,digest-auth,download-calendar,http-url,node-ical,timed-rule}.js"
    ]
  },
  {
    files: ["MMM-CalendarWeek.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        Module: "readonly",
        Log: "readonly",
        config: "readonly",
        document: "readonly",
        moment: "readonly"
      }
    },
    rules: noUndefinedVariables
  },
  {
    files: [
      "*.js", "test/**/*.js",
      "vendor/ical.js/*.js"
    ],
    ignores: ["MMM-CalendarWeek.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        AbortSignal: "readonly",
        Buffer: "readonly",
        Headers: "readonly",
        URL: "readonly",
        __dirname: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        fetch: "readonly",
        global: "readonly",
        process: "readonly",
        setTimeout: "readonly"
      }
    },
    rules: noUndefinedVariables
  }
];
