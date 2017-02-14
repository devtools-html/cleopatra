import { connect } from 'react-redux';
import IntervalMarkerOverview from '../components/IntervalMarkerOverview';
import { selectorsForThread } from '../selectors/';

export default connect((state, props) => {
  const { threadIndex } = props;
  const selectors = selectorsForThread(threadIndex);
  return {
    intervalMarkers: selectors.getTracingMarkers(state),
    threadName: selectors.getThread(state).name,
  };
})(IntervalMarkerOverview);
