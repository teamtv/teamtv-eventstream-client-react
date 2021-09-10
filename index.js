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

const periodState = (periodEvents) => {
  const eventTypes = periodEvents.map(({eventType}) => eventType);
  if (eventTypes.indexOf("endPeriod") !== -1) {
    return "ENDED";
  } else if (eventTypes.indexOf("startPeriod") !== -1) {
    return "STARTED";
  } else {
    return "NOT-STARTED";
  }
};

const statsCollector = (eventLog, type, preCalculated) => {
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
        period1: periodState(periodEvents.filter(({period}) => period === '1')),
        period2: periodState(periodEvents.filter(({period}) => period === '2')),
        period3: periodState(periodEvents.filter(({period}) => period === '3')),
        period4: periodState(periodEvents.filter(({period}) => period === '4'))
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

const StatsProvider = ({endpointUrl, children}) => {
  const [eventLog, setEventLog] = useState([])
  const [serverTime, setServerTime] = useState(0);
  const [lastTimestamp, setLastTimestamp] = useState(null);

  useEffect(() => {
    const interval = setInterval(
        () => {
          if (!!lastTimestamp)
          {
            setServerTime(
                (performance.now() - lastTimestamp.now) + lastTimestamp.serverTime
            );
          }
      }, 1000);
    return () => {
      clearInterval(interval);
    }
  }, [lastTimestamp])

  useEffect(() => {
    setEventLog([]);

    const eventStreamSource = new PollingEventStreamSource(endpointUrl);
    const eventStream = new EventStream(eventStreamSource);

    const _eventLog = [];
    const scheduleFlush = debounce(() => {
      setEventLog(_eventLog.slice());
    }, 10);

    const scheduleLastTimestamp = debounce((timestamp) => {
      setLastTimestamp({
        serverTime,
        now: performance.now()
      })
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
      addEvent({id, eventType: "shot", result, personId, teamId, time, person, type});
    });
    eventStream.on("goalCorrection", ({id, teamId, time}, timestamp) => {
      addEvent({eventType: "goalCorrection", id, teamId, time});
    });
    eventStream.on("substitution", ({id, teamId, time, inPersonId, inPerson, outPersonId, outPerson}, timestamp) => {
      addEvent({id, eventType: "substitution", teamId, time, inPersonId, inPerson, outPersonId, outPerson});
    });

    eventStream.on("startPeriod", ({period}, timestamp) => {
      addEvent({eventType: "startPeriod", period});
    });
    eventStream.on("endPeriod", ({period}, timestamp) => {
      addEvent({eventType: "endPeriod", period});
    });
    eventStream.on("observationRemoved", ({id}, timestamp) => {
      addEvent({eventType: "removed", id});
    });

    return () => {
      eventStreamSource.stop();
    }
  }, [endpointUrl]);

  return (
    <Context.Provider value={eventLog}>
      {children}
    </Context.Provider>
  );
};

const StatsConsumer = ({types, children}) => {
  return (
    <Context.Consumer>
      {
        (eventLog) => {
          const stats = {
            match: statsCollector(eventLog, 'match'),
          };
          if (stats.match) {
            for (const statsType of types) {
              stats[statsType] = statsCollector(eventLog, statsType, stats);
            }
          }
          return children(stats);
        }
      }
    </Context.Consumer>
  )
};

export { StatsProvider, StatsConsumer };