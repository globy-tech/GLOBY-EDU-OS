const fs = require('fs');
const os = require('os');
const path = require('path');

function useIsolatedSchoolStore() {
  const previousFile = process.env.GLOBY_SCHOOLS_FILE;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'globyedu-school-test-'));
  const schoolFile = path.join(directory, 'schools.json');
  fs.writeFileSync(schoolFile, JSON.stringify({ schools: [] }), 'utf8');
  process.env.GLOBY_SCHOOLS_FILE = schoolFile;

  return () => {
    if (previousFile === undefined) delete process.env.GLOBY_SCHOOLS_FILE;
    else process.env.GLOBY_SCHOOLS_FILE = previousFile;
    fs.rmSync(directory, { recursive: true, force: true });
  };
}

module.exports = useIsolatedSchoolStore;
