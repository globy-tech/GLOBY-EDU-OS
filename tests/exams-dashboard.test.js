const fs = require('fs');
const path = require('path');

describe('school examinations workspace', () => {
  it('renders dedicated examination and grading views for school authority', () => {
    const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'school-dashboard.js'), 'utf8');
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');

    expect(dashboardSource).toContain('Examinations & Grading');
    expect(dashboardSource).toContain('Create exam');
    expect(dashboardSource).toContain('Generate report card');
    expect(dashboardSource).toContain('Transcript');
    expect(dashboardSource).toContain('Search exams');
    expect(dashboardSource).toContain('Mark entry');
    expect(dashboardSource).toContain('Export PDF');
    expect(dashboardSource).toContain('grading system');
    expect(mainSource).toContain('createExamRecord');
    expect(mainSource).toContain('generateReportCard');
  });

  it('provides a teacher report-card sheet with assigned-student autocomplete and editable headings', () => {
    const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'pages', 'school-dashboard.js'), 'utf8');
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'marketing', 'src', 'main.js'), 'utf8');

    expect(dashboardSource).toContain('data-teacher-workspace-action="create-report-card"');
    expect(mainSource).toContain('function showTeacherReportCardForm');
    expect(mainSource).toContain('<datalist id="teacher-report-student-options">');
    expect(mainSource).toContain('data-report-heading="${index}"');
    expect(mainSource).toContain('data-report-add-row');
    expect(mainSource).toContain('reportColumns,');
    expect(mainSource).toContain('reportCells: cells');
    expect(mainSource).toContain('Choose a student from the assigned-student suggestions.');
    expect(dashboardSource).toContain("function renderReportSheets(results = [], students = [], schoolName = '')");
    expect(dashboardSource).toContain('renderReportSheets(reportSheetResults,');
    expect(dashboardSource).toContain('const scoredResultList = resultList.filter');
    expect(dashboardSource).toContain('data-print-report-card');
    expect(dashboardSource).toContain('student?.profilePhoto || student?.passportPhoto');
    expect(mainSource).toContain('printWindow.print()');
    expect(mainSource).toContain('report-card-table');
  });
});
