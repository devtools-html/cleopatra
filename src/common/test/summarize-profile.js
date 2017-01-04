import 'babel-polyfill';
import { describe, it } from 'mocha';
import { assert } from 'chai';
import { summarizeProfile } from '../summarize-profile';

const profile = require('./fixtures/profile-2d-canvas.json');

describe('summarize-profile', function () {
  const [geckoMain, compositor, content] = summarizeProfile(profile);

  it('has the thread names', function () {
    assert.equal(geckoMain.thread, 'GeckoMain');
    assert.equal(compositor.thread, 'Compositor');
    assert.equal(content.thread, 'Content');
  });

  // Probably not the most brilliant test, but assert that the values are the same from
  // a previous run on a profile.
  it('categorizes samples', () => {
    const {summary} = geckoMain;

    let i = 0;
    for (const { category, samples, percentage } of [
      { category: 'idle', samples: 142, percentage: 0.48464163822525597 },
      { category: 'script', samples: 113, percentage: 0.3856655290102389 },
      { category: 'script.baseline', samples: 28, percentage: 0.09556313993174062 },
      { category: 'dom', samples: 18, percentage: 0.06143344709897611 },
      { category: 'script.compile', samples: 16, percentage: 0.05460750853242321 },
      { category: 'script.compile.baseline', samples: 14, percentage: 0.04778156996587031 },
      { category: 'uncategorized', samples: 7, percentage: 0.023890784982935155 },
      { category: 'frameconstruction', samples: 6, percentage: 0.020477815699658702 },
      { category: 'network', samples: 4, percentage: 0.013651877133105802 },
      { category: 'script.parse', samples: 4, percentage: 0.013651877133105802 },
      { category: 'script.compile.ion', samples: 2, percentage: 0.006825938566552901 },
      { category: 'wait', samples: 2, percentage: 0.006825938566552901 },
      { category: 'script.icupdate', samples: 2, percentage: 0.006825938566552901 },
      { category: 'restyle', samples: 1, percentage: 0.0034129692832764505 }
    ]) {
      assert.equal(summary[i].category, category,
                   `summary ${i} should be category ${category}, not ${summary[i].category}`);
      assert.equal(summary[i].samples, samples,
                   `summary ${i} should have ${samples} in category ${category}, not ${summary[i].samples}`);
      assertFloatEquals(summary[i].percentage, percentage);
      i++;
    }
  });

  it('provides a rolling summary', () => {
    const {rollingSummary} = geckoMain;
    assert.ok(Array.isArray(rollingSummary));

    const hasSamples = (memo, {samples}) => memo && typeof samples === 'object';
    assert.ok(rollingSummary.reduce(hasSamples, true),
      'Each summary has samples');

    const hasPercentages = (memo, {percentage}) => memo && typeof percentage === 'object';
    assert.ok(rollingSummary.reduce(hasPercentages, true),
      'Each summary has percentages');

    for (const {samples} of rollingSummary) {
      for (const [name, value] of Object.entries(samples)) {
        assert.ok(value > 0, `"${name}" has a sample count greater than 0.`);
      }
    }

    for (const {percentage} of rollingSummary) {
      for (const [name, value] of Object.entries(percentage)) {
        assert.ok(value > 0, `"${name}" has a percentage count greater than 0.`);
        assert.ok(value <= 1, `"${name}" has a percentage count greater than 0.`);
      }
    }
  });

  it('provides sane rolling summary values', () => {
    const {samples, percentage} = geckoMain.rollingSummary[0];
    assert.equal(samples.wait, 2);
    assert.equal(samples.idle, 1);
    assert.equal(samples['script.compile.baseline'], 2);
    assert.equal(samples.script, 12);
    assert.equal(samples.dom, 1);

    assertFloatEquals(percentage.wait, 0.10526315789473684);
    assertFloatEquals(percentage.idle, 0.05263157894736842);
    assertFloatEquals(percentage['script.compile.baseline'], 0.10526315789473684);
    assertFloatEquals(percentage.script, 0.631578947368421);
    assertFloatEquals(percentage.dom, 0.05263157894736842);
  });
});

function assertFloatEquals(a, b, message) {
  assert.ok(Math.abs(a - b) < 0.0001, message || `expected ${a} to be ${b}`);
}
