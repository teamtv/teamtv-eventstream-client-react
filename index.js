import React, { useEffect, useState } from 'react';

import { EventStream, PollingEventStreamSource } from "@teamtv/eventstream-client";

const debounce = (func, wait, immediate) => {
  let timeout;
  return function () {
    const context = this, args = arguments;
    const later = () => {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(context, args);
  };
};

const periodState = (periodEvents, serverTime) => {
  const eventTypes = periodEvents.map(({eventType}) => eventType);
  if (eventTypes.indexOf("endPeriod") !== -1) {
    return {state: "ENDED"};
  } else if (eventTypes.indexOf("startPeriod") !== -1) {
    let time = null;
    if (serverTime !== 0) {
      for (const event of periodEvents) {
        if (event.eventType === 'startPeriod') {
          time = serverTime - (new Date(event.occurredOn) / 1000);
        }
      }
    }
    return {state: "STARTED", time};
  } else {
    return {state: "NOT-STARTED"};
  }
};

const statsCollector = (eventLog, type, preCalculated, serverTime) => {
  switch (type) {
    case 'match': {
      const createdEvents = eventLog.filter(({eventType}) => eventType === "sportingEventCreated");
      if (createdEvents.length === 1) {
        return {
          homeTeam: createdEvents[0].homeTeam,
          awayTeam: createdEvents[0].awayTeam,
          scheduledAt: createdEvents[0].scheduledAt
        };
      } else {
        return null;
      }
    }
    case 'score': {
      const match = preCalculated.match || statsCollector(eventLog, 'match');
      const goals = eventLog.filter(({eventType, result}) => (eventType === "shot" && result === "GOAL") || eventType === "goalCorrection");
      return {
        home: goals.filter(({teamId}) => teamId === match.homeTeam.teamId).length,
        away: goals.filter(({teamId}) => teamId === match.awayTeam.teamId).length,
      };
    }
    case 'period': {
      const periodEvents = eventLog.filter(({eventType}) => eventType === "startPeriod" || eventType === "endPeriod");
      return {
        period1: periodState(periodEvents.filter(({period}) => period === '1'), serverTime),
        period2: periodState(periodEvents.filter(({period}) => period === '2'), serverTime),
        period3: periodState(periodEvents.filter(({period}) => period === '3'), serverTime),
        period4: periodState(periodEvents.filter(({period}) => period === '4'), serverTime)
      };
    }
    case 'goals': {
      const match = preCalculated.match || statsCollector(eventLog, 'match');
      const score = {home: 0, away: 0};
      return eventLog.filter(
          ({eventType, result}) => (eventType === "shot" && result === "GOAL") || eventType === "goalCorrection"
      ).map((goal) => {
        if (goal.teamId === match.homeTeam.teamId) {
          score.home += 1;
        } else {
          score.away += 1;
        }
        return {
          score: {home: score.home, away: score.away}, // copy
          team: goal.teamId === match.homeTeam.teamId ? match.homeTeam : match.awayTeam,
          ...goal
        };
      });
    }
    case 'substitutions': {
      const match = preCalculated.match || statsCollector(eventLog, 'match');
      return eventLog.filter(
          ({eventType}) => eventType === "substitution"
      ).map((substitution) => {
        return {
          team: substitution.teamId === match.homeTeam.teamId ? match.homeTeam : match.awayTeam,
          ...substitution
        }
      });
    }
    case 'shots':
      return eventLog.filter(({eventType}) => eventType === "shot");
    case 'raw':
      return eventLog.slice();

  }
};

const Context = React.createContext([]);

const StatsProvider = ({endpointUrl, children, options}) => {
  const [eventLog, setEventLog] = useState([]);
  const [serverTime, setServerTime] = useState(0);
  const [lastTimestamp, setLastTimestamp] = useState(null);

  useEffect(() => {
    const interval = setInterval(
        () => {
          if (!!lastTimestamp)
          {
            setServerTime(
                (performance.now() - lastTimestamp.now) / 1000 + lastTimestamp.serverTime
            );
          }
        }, 1000);
    return () => {
      clearInterval(interval);
    }
  }, [lastTimestamp]);

  useEffect(() => {
    setEventLog([]);

    let refreshInterval = parseInt(options.refreshInterval) || 5;
    if (refreshInterval < 5) {
      refreshInterval = 5;
    } else if (refreshInterval > 120) {
      refreshInterval = 120;
    }

    const eventStreamSource = new PollingEventStreamSource(endpointUrl, refreshInterval);
    const eventStream = new EventStream(eventStreamSource, options.periodCount || 2);

    const _eventLog = [];
    const scheduleFlush = debounce(() => {
      setEventLog(_eventLog.slice());
    }, 10);

    const scheduleLastTimestamp = debounce((timestamp) => {
      setLastTimestamp({
        serverTime: timestamp,
        now: performance.now()
      });
      setServerTime(timestamp);
    }, 10);

    const addEvent = (event) => {
      if (event.eventType === "removed") {
        if (!!event.id) {
          const index = _eventLog.findIndex(({id}) => id === event.id);
          if (index !== -1) {
            _eventLog.splice(index, 1);
          }
        }
      } else {
        _eventLog.push(event);
      }

      scheduleFlush();
    };

    eventStream.on("sportingEventCreated", ({homeTeam, awayTeam, scheduledAt}, timestamp) => {
      scheduleLastTimestamp(timestamp);

      addEvent({eventType: "sportingEventCreated", homeTeam, awayTeam, scheduledAt});
    });

    eventStream.on("shot", ({id, time, personId, person, result, type, possession: {teamId}}, timestamp) => {
      scheduleLastTimestamp(timestamp);

      addEvent({id, eventType: "shot", result, personId, teamId, time, person, type});
    });
    eventStream.on("goalCorrection", ({id, teamId, time}, timestamp) => {
      scheduleLastTimestamp(timestamp);

      addEvent({eventType: "goalCorrection", id, teamId, time});
    });
    eventStream.on("substitution", ({id, teamId, time, inPersonId, inPerson, outPersonId, outPerson}, timestamp) => {
      scheduleLastTimestamp(timestamp);

      addEvent({id, eventType: "substitution", teamId, time, inPersonId, inPerson, outPersonId, outPerson});
    });

    eventStream.on("startPeriod", ({period, occurredOn}, timestamp) => {
      scheduleLastTimestamp(timestamp);

      addEvent({eventType: "startPeriod", period, occurredOn});
    });
    eventStream.on("endPeriod", ({period}, timestamp) => {
      scheduleLastTimestamp(timestamp);

      addEvent({eventType: "endPeriod", period});
    });
    eventStream.on("observationRemoved", ({id}, timestamp) => {
      scheduleLastTimestamp(timestamp);

      addEvent({eventType: "removed", id});
    });

    return () => {
      eventStreamSource.stop();
    }
  }, [endpointUrl]);

  return (
      <Context.Provider value={{serverTime, eventLog}}>
        {children}
      </Context.Provider>
  );
};

const StatsConsumer = ({types, children}) => {
  return (
      <Context.Consumer>
        {
          ({eventLog, serverTime}) => {
            const stats = {
              match: statsCollector(eventLog, 'match'),
            };
            if (stats.match) {
              for (const statsType of types) {
                stats[statsType] = statsCollector(eventLog, statsType, stats, serverTime);
              }
            }
            return children(stats);
          }
        }
      </Context.Consumer>
  )
};

export { StatsProvider, StatsConsumer };