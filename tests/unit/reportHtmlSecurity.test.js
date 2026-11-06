const { createHtmlReport } = require('../../utils/reportUtils');

describe('HTML report output', () => {
  test('escapes stored credit and metadata text before rendering', () => {
    const attack = '</td><script>alert(1)</script>';
    const html = createHtmlReport(
      [
        {
          createdAt: '2026-10-29',
          facultySnapshot: { name: attack, facultyID: attack },
          title: attack,
          type: 'positive',
          points: 5,
          status: 'approved',
        },
      ],
      { title: attack, level: attack, date: attack },
      { pdf: '/safe.pdf', excel: '/safe.xlsx' },
    );

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('escapes report link attributes', () => {
    const html = createHtmlReport(
      [{ name: 'A', facultyID: 'A', department: 'D', positive: 1, negative: 0, total: 1, count: 1 }],
      { title: 'Ranking', level: 'College', date: 'Today' },
      { pdf: '/safe.pdf" onclick="alert(1)', excel: '/safe.xlsx' },
      'ranking',
    );

    expect(html).not.toContain('onclick="alert(1)"');
    expect(html).toContain('&quot; onclick=&quot;');
  });
});
