# EventStream Client React Component

_Simple React component for the teamtv event stream API_

## Installation

```bash
npm install --save @teamtv/eventstream-client-react
```

## Usage

```jsx
import { StatsProvider, StatsConsumer } from '@teamtv/eventstream-client-react';

const ScoreWidget = ({match, score}) => {
  return (
    <StatsConsumer types={["score"]}>
      {({match, score}) => (
        <div>{match.homeTeam.name} - {match.awayTeam.name}</div>
        <div>{score.home} - {score.away}</div>      
      )}
    </StatsConsumer>
  );
};

ReactDOM.render(
  <StatsProvider endpointUrl="<teamtv eventstream endpoint>">
    <ScoreWidget />
  </StatsProvider>,
  document.getElementById("app")
);


```
