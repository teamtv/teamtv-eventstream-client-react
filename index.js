import React, { useEffect, useStat } from 'react';

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

const statsCollector = (eventLog, type, preCalculated) => {
  switch (type) {
    case 'match':
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
    case 'score':
      const match = preCalculated.match || statsCollector(eventLog, 'match');
      const goals = eventLog.filter(({eventType}) => eventType === "goal");
      return {
        home: goals.filter(({teamId}) => teamId === match.homeTeam.teamId).length,
        away: goals.filter(({teamId}) => teamId === match.awayTeam.teamId).length,
      };
  }
};

const Context = React.createContext([]);

const StatsProvider = ({endpointUrl, children}) => {
  const [eventLog, setEventLog] = React.useState([]);

  useEffect(() => {
    setEventLog([]);

    const eventStreamSource = new PollingEventStreamSource(endpointUrl);
    const eventStream = new EventStream(eventStreamSource);

    const _eventLog = [];
    const scheduleFlush = debounce(() => {
      setEventLog(eventLog.concat(_eventLog));
      _eventLog.splice(0, _eventLog.length);
    }, 10);

    const addEvent = (event) => {
      _eventLog.push(event);
      scheduleFlush();
    };

    eventStream.on("sportingEventCreated", ({homeTeam, awayTeam, scheduledAt}) => {
      addEvent({eventType: "sportingEventCreated", homeTeam, awayTeam, scheduledAt});
    });

    eventStream.on("shot", ({time, person, result, type, possession: {teamId}}) => {
      if (result === "GOAL") {
        addEvent({eventType: "goal", teamId, time, person, type});
      }
    });
    eventStream.on("startPeriod", ({period}) => {
      addEvent({eventType: "startPeriod", period});
    });
    eventStream.on("endPeriod", ({period}) => {
      addEvent({eventType: "startPeriod", period});
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
        ({value}) => {
          const stats = {
            match: statsCollector(value, 'match'),
          };
          for(const statsType of types) {
            stats[statsType] = statsCollector(value, statsType, stats);
          }
          return children(stats);
        }
      }
    </Context.Consumer>
  )
};

export { StatsProvider, StatsConsumer };