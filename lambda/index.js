const Alexa = require('ask-sdk-core');
const axios = require('axios');

const readToken = require('./tokens.js');

const listStatuses = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
};

let workouts;
let selectedWorkout;
let personName;
let isFirstTraining = false;
let exercises = [];
let shouldSkipMotivation = false;

let totalExercises;
let prevExercises;
let currentExercise;
let currentExerciseCounter = 0;
let lastReminderToken;
let isLastExercise;

const cleanup = () => {
  prevExercises = exercises.slice(); //shallow copy since destructuring with ... is not supported
  exercises = [];
};

const cleanLastTimer = async (handlerInput) => {
  const reminderApiClient =
    handlerInput.serviceClientFactory.getReminderManagementServiceClient();

  try {
    await reminderApiClient.deleteReminder(lastReminderToken);
  } catch (error) {
    // Not going to delete because a reminder was not created;
  }
};

const getListId = async (handlerInput, listName) => {
  const listClient =
    handlerInput.serviceClientFactory.getListManagementServiceClient();
  const listOfLists = await listClient.getListsMetadata();

  if (!listOfLists) {
    return null;
  }

  const stateListId = listOfLists.lists.find((list) => list.name === listName);

  return stateListId ? stateListId.listId : null;
};

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest' ||
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'StartSkillIntent'
    );
  },

  async handle(handlerInput) {
    // Check permissions
    const { permissions } = handlerInput.requestEnvelope.context.System.user;

    if (!permissions) {
      const speechOutput = `<amazon:emotion name="disappointed" intensity="high">Sorry, it seems you haven't granted the necessary permissions for me to access and create notes in your to-do list and set reminders. Please grant the permissions and summon me again. If you have any questions, follow the instructions on the Skill page.</amazon:emotion>`;
      return handlerInput.responseBuilder
        .speak(speechOutput)
        .withShouldEndSession(true)
        .getResponse();
    }

    const emailAddress = await handlerInput.serviceClientFactory
      .getUpsServiceClient()
      .getProfileEmail()
      .then((email) => {
        return email;
      })
      .catch((error) => {
        console.error('@@@ Error fetching email:', error);

        return 'NO_EMAIL_PERMISSIONS';
      });

    if (emailAddress === 'NO_EMAIL_PERMISSIONS') {
      const speechOutput =
        '<amazon:emotion name="disappointed" intensity="high">Sorry, it seems you haven\'t granted the necessary permissions for me to identify your email address. Please grant permission in the Alexa app on your phone and summon me again.</amazon:emotion>';

      return handlerInput.responseBuilder
        .speak(speechOutput)
        .withShouldEndSession(true)
        .getResponse();
    }

    const workoutsFetching = await axios
      .get(
        `https://api.meutreino.fit/api/workouts?filters[authorEmail][$eq]=${emailAddress}`,
        {
          headers: {
            Authorization: `Bearer ${readToken}`,
          },
        }
      )
      .then((response) => {
        const { data } = response.data;

        if (data.length === 0) {
          return 'NO_TRAININGS';
        }

        return data;
      })
      .catch((error) => {
        return 'ERROR_FETCHING_TRAININGS';
      });

    if (workoutsFetching === 'ERROR_FETCHING_TRAININGS') {
      const speechOutput =
        '<amazon:emotion name="disappointed" intensity="high">Hello! There was an error synchronizing your workouts with myworkoutskill.com. Please try starting your workout again!</amazon:emotion>';

      return handlerInput.responseBuilder
        .speak(speechOutput)
        .withShouldEndSession(true)
        .getResponse();
    }

    if (workoutsFetching === 'NO_TRAININGS') {
      const speechOutput =
        '<amazon:emotion name="disappointed" intensity="high">Hello, welcome to My Workout! It seems you haven\'t registered yet or haven\'t created any workouts on myworkoutskill.com. Please visit myworkoutskill.com, create your workouts with the help of our artificial intelligence, and summon me again!</amazon:emotion>';

      return handlerInput.responseBuilder
        .speak(speechOutput)
        .withShouldEndSession(true)
        .getResponse();
    }

    workouts = workoutsFetching;
    personName = workouts[0].attributes.authorName.match(/^\w+(?=\s)/)
      ? workouts[0].attributes.authorName.match(/^\w+(?=\s)/)[0]
      : workouts[0].attributes.authorName;

    const listClient =
      handlerInput.serviceClientFactory.getListManagementServiceClient();
    let stateListId = await getListId(handlerInput, 'My_Workout_Internal');

    if (!stateListId) {
      isFirstTraining = true;

      await listClient.createList({
        name: 'My_Workout_Internal',
        state: listStatuses.ACTIVE,
      });
    }

    /**
     * Cleanup to reset some of the global states
     */
    cleanup();
    cleanLastTimer(handlerInput);
    isLastExercise = null;
    currentExerciseCounter = 0;

    const workoutNames = workouts
      .map((workout) => workout.attributes.name)
      .sort();

    const savedTrainingsSpeech = `<break time="0.3s" />You have ${
      workouts.length
    } ${workouts.length === 1 ? 'workout' : 'workouts'} ${
      workouts.length === 1 ? 'available' : 'available'
    }: ${
      workoutNames.length > 1
        ? workoutNames
            .slice(0, -1)
            .map((name) => `Workout ${name} <break time="0.1s" />`)
            .join(', ') + ` and Workout ${workoutNames.slice(-1)[0]}`
        : `Workout ${workoutNames[0]}`
    }<break time="0.2s" />`;

    if (isFirstTraining) {
      const speechOutput = `<amazon:emotion name="excited" intensity="high">Hello ${personName}! Welcome to your first workout! ${savedTrainingsSpeech}. Which workout would you like to start?</amazon:emotion>`;
      return handlerInput.responseBuilder
        .speak(speechOutput)
        .reprompt(
          '<amazon:emotion name="excited" intensity="high">Are you there? Which of the workouts do you want to start?</amazon:emotion>'
        )
        .getResponse();
    } else {
      const speechOutput = `<amazon:emotion name="excited" intensity="high">Hello ${personName}, welcome back to My Workout, or should I say, your workout! ${savedTrainingsSpeech}. Which workout would you like to start?</amazon:emotion>`;
      return handlerInput.responseBuilder
        .speak(speechOutput)
        .reprompt(
          '<amazon:emotion name="excited" intensity="high">Are you there? Which workout do you want to start?</amazon:emotion>'
        )
        .getResponse();
    }
  },
};

const StartTrainingIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) ===
        'StartTrainingIntent' &&
      handlerInput.requestEnvelope.request.intent.slots.trainingName.value
    );
  },
  async handle(handlerInput) {
    const { value } =
      handlerInput.requestEnvelope.request.intent.slots.trainingName;
    const listClient =
      handlerInput.serviceClientFactory.getListManagementServiceClient();
    let stateListId = await getListId(handlerInput, 'My_Workout_Internal');

    const workoutNames = workouts.map((workout) => workout.attributes.name); // for the error message
    const invalidTrainingSpeech = `${
      workoutNames.length > 1
        ? workoutNames
            .slice(0, -1)
            .map((name) => `Workout ${name}`)
            .join(', ') + ` and Workout ${workoutNames.slice(-1)[0]}`
        : `Workout ${workoutNames[0]}`
    }.<break time="0.2s" />`;

    console.log('@@@ Selected training name:', value);

    const valueParsed = value.replace(/^([A-Za-z])\.?$/, '$1').toUpperCase();

    selectedWorkout = workouts.find(
      (workout) => workout.attributes.name === valueParsed
    );

    /**
     * Invalid workout name (asking for a training name that doesn't exist)
     */
    if (!selectedWorkout) {
      const speakOutput = `<amazon:emotion name="excited" intensity="high">The workout ${valueParsed} is not created. Choose a valid workout, such as: ${invalidTrainingSpeech}</amazon:emotion>`;
      return handlerInput.responseBuilder
        .speak(speakOutput)
        .reprompt(
          `<amazon:emotion name="excited" intensity="high">Are you still there? If you still want to train, choose a valid workout, such as: ${invalidTrainingSpeech}</amazon:emotion>`
        )
        .getResponse();
    }

    const workoutDescription = selectedWorkout.attributes.description;
    shouldSkipMotivation = !selectedWorkout.attributes.motivation;

    if (
      !selectedWorkout.attributes.exercises ||
      (selectedWorkout.attributes.exercises &&
        selectedWorkout.attributes.exercises.length === 0)
    ) {
      const speechOutput = `<amazon:emotion name="disappointed" intensity="high">It seems you haven't added any exercises to your ${workoutDescription} yet. Please visit myworkoutskill.com and add exercises to your workout.</amazon:emotion>`;

      return handlerInput.responseBuilder
        .speak(speechOutput)
        .withShouldEndSession(true)
        .getResponse();
    }

    exercises = selectedWorkout.attributes.exercises.map((exercise) => {
      return {
        name: exercise.name,
        reps: parseInt(exercise.reps, 10),
        series: parseInt(exercise.series, 10),
        howTo: exercise.howTo ? exercise.howTo : '',
        interval: {
          name:
            exercise.interval < 60
              ? `${exercise.interval} second${
                  exercise.interval !== 1 ? 's' : ''
                }`
              : `${Math.floor(exercise.interval / 60)} minute${
                  Math.floor(exercise.interval / 60) !== 1 ? 's' : ''
                }${
                  Math.floor(exercise.interval / 60) !== 0 &&
                  exercise.interval % 60 !== 0
                    ? ' e '
                    : ''
                }${
                  exercise.interval % 60 !== 0
                    ? `${exercise.interval % 60} second${
                        exercise.interval % 60 !== 1 ? 's' : ''
                      }`
                    : ''
                }`,
          reminderTime: `${exercise.interval}`,
        },
        currentSerie: 1,
      };
    });

    totalExercises = exercises.length - 1;
    currentExercise = exercises[currentExerciseCounter];

    const { name, series, reps, howTo, currentSerie } = currentExercise;

    /**
     * Create the persistence note items.
     * Removing on creation is necessary to ensure the list is reseted:
     * e.g. user asked to start workout before the previous one got to the last exercise.
     */
    if (stateListId) {
      await listClient.deleteList(stateListId);
    }

    await listClient.createList({
      name: 'My_Workout_Internal',
      state: listStatuses.ACTIVE,
    });

    stateListId = await getListId(handlerInput, 'My_Workout_Internal'); // get the updated list id

    await listClient.createListItem(stateListId, {
      value: `CURRENT_WORKOUT_ID=${selectedWorkout.id}`,
      status: listStatuses.ACTIVE,
    });
    await listClient.createListItem(stateListId, {
      value: `SKIP_MOTIVATION=${!selectedWorkout.attributes.motivation}`,
      status: listStatuses.ACTIVE,
    });
    await listClient.createListItem(stateListId, {
      value: `CURRENT_EXERCISE_NAME=${name}`,
      status: listStatuses.ACTIVE,
    });
    await listClient.createListItem(stateListId, {
      value: `CURRENT_SERIE=${currentSerie}`,
      status: listStatuses.ACTIVE,
    });

    const randomMotivation = [
      "Let's start",
      "Let's go",
      'Here we go',
      "Let's get started",
      "Come on, let's go",
    ];

    const randomConfirmation = [
      `Alright, ${workoutDescription}`,
      `Starting ${workoutDescription}`,
      `${workoutDescription} then`,
      `All set for your ${workoutDescription}`,
      `Okay, ${workoutDescription}`,
    ];

    const seriesToSay = series === 1 ? 'one' : series === 2 ? 'two' : series;
    const repsToSay = reps === 1 ? 'one' : reps === 2 ? 'two' : reps;

    let exerciseSpeech = '';

    if (howTo) {
      exerciseSpeech = `<break time="0.2s" />Your first exercise is ${name}.<break time="0.2s" /> You will do ${seriesToSay} ${
        series === 1 ? 'set' : 'sets'
      } of ${repsToSay} ${
        reps === 1 ? 'repetition' : 'repetitions'
      }.<break time="0.2s" /> ${howTo}<break time="0.2s" /> ${
        isFirstTraining
          ? `You need to inform me every time you finish a set.<break time="0.2s" /> To do this, just say: Alexa, rest in my workout.<break time="0.2s" /> That way I'll know when to remind you to continue the workout.<break time="0.2s" /> You can start your first set of ${name} and when you finish, say: Alexa, rest in my workout.`
          : `You can start your first set of ${name}, and when you finish, inform me by saying: Alexa, rest in my workout.`
      }`;
    } else {
      exerciseSpeech = `<break time="0.2s" />Your first exercise is ${name}.<break time="0.2s" /> You will do ${seriesToSay} ${
        series === 1 ? 'set' : 'sets'
      } of ${repsToSay} ${
        reps === 1 ? 'repetition' : 'repetitions'
      }.<break time="0.2s" /> ${
        isFirstTraining
          ? `You need to inform me every time you finish a set.<break time="0.2s" /> To do this, just say: Alexa, rest in my workout.<break time="0.2s" /> That way I'll know when to remind you to continue the workout.<break time="0.2s" /> You can start your first set of ${name} and when you finish, say: Alexa, rest in my workout.`
          : `You can start your first set of ${name}, and when you finish, inform me by saying: Alexa, rest in my workout.`
      }`;
    }

    const speakOutput = `<amazon:emotion name="excited" intensity="high">${
      randomConfirmation[Math.floor(Math.random() * randomConfirmation.length)]
    },<break time="0.2s" /> ${
      randomMotivation[Math.floor(Math.random() * randomMotivation.length)]
    }!. ${exerciseSpeech}</amazon:emotion>`;

    return handlerInput.responseBuilder.speak(speakOutput).getResponse();
  },
};

const IntervalIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'IntervalIntent'
    );
  },
  async handle(handlerInput) {
    const reminderApiClient =
      handlerInput.serviceClientFactory.getReminderManagementServiceClient();
    const listClient =
      handlerInput.serviceClientFactory.getListManagementServiceClient();
    let stateListId = await getListId(handlerInput, 'My_Workout_Internal');
    const list = await listClient.getList(stateListId, listStatuses.ACTIVE);

    cleanLastTimer(handlerInput);

    /**
     * Sometimes alexa will wipe the variables stored in memory.
     * When this happens, we need to refetch the workout from BE and also repopulate the mem variables correctly.
     */
    if (exercises.length === 0) {
      const currentWorkoutIdListItem = list.items.find((note) =>
        note.value.match(/CURRENT_WORKOUT_ID/gi)
      );

      /**
       * In case user is asking for an interval but indeed there's no
       * training in progress (aka current workout id is not present in the lists)
       */
      if (!currentWorkoutIdListItem) {
        const speakOutput =
          '<amazon:emotion name="disappointed" intensity="high">Oops, it seems there is no workout in progress. To start a new workout, say: Alexa, begin my workout.</amazon:emotion>';

        return handlerInput.responseBuilder.speak(speakOutput).getResponse();
      }

      console.log(
        '@@@ Must refetch workouts because alexa cleaned up memory vars.'
      );

      /**
       * A workout id has been found inside the internal note list
       */
      const shouldSkipMotivationListItem = list.items.find((note) =>
        note.value.match(/SKIP_MOTIVATION/gi)
      );

      console.log(
        '@@@ shouldSkipMotivationListItem',
        shouldSkipMotivationListItem
      );

      shouldSkipMotivation = JSON.parse(
        shouldSkipMotivationListItem.value
          .replace('SKIP_MOTIVATION=', '')
          .toLowerCase()
      );

      const emailAddress = await handlerInput.serviceClientFactory
        .getUpsServiceClient()
        .getProfileEmail()
        .then((email) => {
          return email;
        })
        .catch((error) => {
          console.error('@@@ Error fetching email:', error);

          return 'NO_EMAIL_PERMISSIONS';
        });

      if (emailAddress === 'NO_EMAIL_PERMISSIONS') {
        const speechOutput =
          '<amazon:emotion name="disappointed" intensity="high">Sorry, it seems you haven\'t granted the necessary permissions for me to identify your email address. Please grant permission in the Alexa app on your phone and summon me again.</amazon:emotion>';

        return handlerInput.responseBuilder
          .speak(speechOutput)
          .withShouldEndSession(true)
          .getResponse();
      }

      const currentWorkoutIdFromList = currentWorkoutIdListItem.value.replace(
        'CURRENT_WORKOUT_ID=',
        ''
      );

      const workoutFetching = await axios
        .get(
          `https://api.meutreino.fit/api/workouts?filters[authorEmail][$eq]=${emailAddress}&filters[id][$eq]=${currentWorkoutIdFromList}`,
          {
            headers: {
              Authorization: `Bearer ${readToken}`,
            },
          }
        )
        .then((response) => {
          const { data } = response.data;

          if (data.length === 0) {
            return 'NO_TRAININGS';
          }

          return data;
        })
        .catch((error) => {
          return 'ERROR_FETCHING_TRAININGS';
        });

      workouts = workoutFetching;

      console.log('@@@ refetched workouts:', workouts);

      selectedWorkout = workouts[0];

      personName = selectedWorkout.attributes.authorName.match(/^\w+(?=\s)/)
        ? selectedWorkout.attributes.authorName.match(/^\w+(?=\s)/)[0]
        : selectedWorkout.attributes.authorName;

      const currentExerciseListItem = list.items.find((note) =>
        note.value.match(/CURRENT_EXERCISE_NAME/gi)
      );

      const currentExerciseName = currentExerciseListItem.value.replace(
        'CURRENT_EXERCISE_NAME=',
        ''
      );

      const currentSerieListItem = list.items.find((note) =>
        note.value.match(/CURRENT_SERIE/gi)
      );

      const currentSerieListValue = currentSerieListItem.value.replace(
        'CURRENT_SERIE=',
        ''
      );

      exercises = selectedWorkout.attributes.exercises.map((exercise) => {
        return {
          name: exercise.name,
          reps: parseInt(exercise.reps, 10),
          series: parseInt(exercise.series, 10),
          howTo: exercise.howTo ? exercise.howTo : '',
          interval: {
            name:
              exercise.interval < 60
                ? `${exercise.interval} second${
                    exercise.interval !== 1 ? 's' : ''
                  }`
                : `${Math.floor(exercise.interval / 60)} minute${
                    Math.floor(exercise.interval / 60) !== 1 ? 's' : ''
                  }${
                    Math.floor(exercise.interval / 60) !== 0 &&
                    exercise.interval % 60 !== 0
                      ? ' e '
                      : ''
                  }${
                    exercise.interval % 60 !== 0
                      ? `${exercise.interval % 60} second${
                          exercise.interval % 60 !== 1 ? 's' : ''
                        }`
                      : ''
                  }`,
            reminderTime: `${exercise.interval}`,
          },
          currentSerie:
            exercise.name === currentExerciseName
              ? parseInt(currentSerieListValue, 10)
              : 1,
        };
      });

      totalExercises = exercises.length - 1;
      currentExerciseCounter = exercises.findIndex(
        (exercise) => exercise.name === currentExerciseName
      );
      currentExercise = exercises[currentExerciseCounter];
    }

    /**
     * This needs to be gathered before flipping to the next exercise.
     * Otherwise, the reminder will pick the upcoming exercise interval in the last series of the current exercise.
     */
    const intervalToSet = currentExercise.interval;

    if (currentExercise.currentSerie === currentExercise.series) {
      currentExerciseCounter++;

      currentExercise = exercises[currentExerciseCounter];
    } else {
      currentExercise.currentSerie++;
    }

    const { name, reps, series, currentSerie, howTo } = currentExercise;

    isLastExercise =
      currentExercise.currentSerie === currentExercise.series &&
      totalExercises === currentExerciseCounter;

    /**
     * Update the persistence note items - if it's not last exercise.
     * If it is, we only need to cleanup all the items and leave just the list created.
     */

    if (stateListId) {
      await listClient.deleteList(stateListId);
    }

    await listClient.createList({
      name: 'My_Workout_Internal',
      state: listStatuses.ACTIVE,
    });

    stateListId = await getListId(handlerInput, 'My_Workout_Internal'); // get the updated list id

    if (!isLastExercise) {
      await listClient.createListItem(stateListId, {
        value: `CURRENT_WORKOUT_ID=${selectedWorkout.id}`,
        status: listStatuses.ACTIVE,
      });
      await listClient.createListItem(stateListId, {
        value: `SKIP_MOTIVATION=${!selectedWorkout.attributes.motivation}`,
        status: listStatuses.ACTIVE,
      });
      await listClient.createListItem(stateListId, {
        value: `CURRENT_EXERCISE_NAME=${name}`,
        status: listStatuses.ACTIVE,
      });
      await listClient.createListItem(stateListId, {
        value: `CURRENT_SERIE=${currentSerie}`,
        status: listStatuses.ACTIVE,
      });
    }

    const randomReminderInitial = [
      'Okay',
      'Alright',
      'Sure',
      'All good',
      'You got it',
      'Leave it to me',
      'Great',
      'Okay',
      'Understood',
    ];

    const randomReminder = [
      `I'll remind you to resume your set in ${intervalToSet.name}`,
      `I'll let you know in ${intervalToSet.name}`,
      `We'll continue with the next set in ${intervalToSet.name}`,
      `We'll continue in ${intervalToSet.name}`,
      `I'll notify you in ${intervalToSet.name}`,
    ];

    const randomTip = [
      "Take the opportunity to hydrate yourself if you're thirsty",
      "Remember to increase the intensity or load of your exercise if it's too easy",
      'Breathe properly during sets, it will alleviate the pressure on your body during exercise execution',
      'Maintain a healthy diet and follow a balanced diet to complement your workout',
      "Remember that it's important for your rest to be compatible with the effort, so take days to rest",
      'Be careful with your posture during exercise execution',
      "Let's go, you're almost there!",
      'You are doing great, keep it up!',
      "I'm liking what I see!",
      'Believe in yourself, you are stronger than you think!',
      'Every drop of sweat is a step closer to your goal!',
      'Success comes to those who strive and persist!',
      "Don't give up, what seems impossible today will be just another achievement tomorrow!",
      'Be consistent and the results will come!',
      'You are capable of overcoming any challenge that comes your way!',
      'The path to success is paved with dedication and determination!',
      'Never underestimate the power of your mind to turn your dreams into reality!',
      'The impossible only exists until someone decides to make it possible!',
      'Remember that progress is important, no matter how slow you go!',
      'Every day is a new opportunity to improve!',
      "Don't let the fear of failure stop you from trying!",
      'The journey to success begins with a single step!',
      'Success is not a destination, it is a journey!',
      'Small victories are as important as big ones!',
      "Don't compare your progress with others, compare it with your own yesterday!",
      'Failure is just an opportunity to start again with more wisdom!',
      'You are braver than you think, stronger than you imagine, and more capable than you believe!',
      "If you want something you've never had, you must do something you've never done!",
      'The pain you feel today will be the strength you feel tomorrow!',
      'There is no elevator to success, you have to take it step by step!',
      "Don't put off until tomorrow what you can start today!",
      'Success is the sum of small efforts repeated day in and day out!',
      'You cannot change the wind, but you can adjust the sails of the boat!',
      'The secret of success is the constancy of purpose!',
      'Believe in yourself and everything will be possible!',
      "Don't wait for opportunities, create them!",
      'Discipline is the bridge between goals and accomplishments!',
      'There is no victory without struggle!',
      'The biggest obstacle to success is the fear of failure!',
      "It doesn't matter how slowly you go, as long as you don't stop!",
      'What you do today can improve all your tomorrows!',
      'Time is precious, don’t waste it, invest in yourself!',
      'Success is not the result of a single effort, it is the result of a constant commitment!',
      "Don't let the desire to quit be greater than the desire to continue!",
      "Don't stop until you're proud of how far you've come!",
      'Turn every obstacle into an opportunity for growth!',
      'What you will achieve tomorrow starts with what you do today!',
      "Don't postpone your dreams, start now!",
      'The journey may be tough, but the arrival will be worth it!',
      'Stop worrying about what could go wrong and start focusing on what could go right!',
      'You are stronger than you think, braver than you believe, and more talented than you imagine!',
      'Success is not for the swift, but for the persistent!',
    ];

    const seriesToSay = series === 1 ? 'one' : series === 2 ? 'two' : series;
    const repsToSay = reps === 1 ? 'one' : reps === 2 ? 'two' : reps;

    let intervalToSay;

    if (currentSerie === 1) {
      intervalToSay = `<speak><amazon:emotion name="excited" intensity="high">End of your rest time. Let's move on to the first set of ${name}. You will do ${seriesToSay} ${
        series === 1 ? 'set' : 'sets'
      } of ${repsToSay} ${
        reps === 1 ? 'repetition' : 'repetitions'
      }.<break time="0.2s" /> ${
        howTo ? howTo : ''
      }. You can start your first set of ${name}.</amazon:emotion></speak>`;
    } else {
      intervalToSay = `<speak><amazon:emotion name="excited" intensity="high">End of your rest time, proceed to set ${currentSerie} of ${name}, doing another ${repsToSay} ${
        reps === 1 ? 'repetition' : 'repetitions'
      }.</amazon:emotion></speak>`;
    }

    const reminderRequest = {
      trigger: {
        type: 'SCHEDULED_RELATIVE',
        offsetInSeconds: intervalToSet.reminderTime,
      },
      alertInfo: {
        spokenInfo: {
          content: [
            {
              locale: 'en-US',
              text: 'My Workout Rest',
              ssml: !isLastExercise
                ? intervalToSay
                : `<speak><amazon:emotion name="excited" intensity="high">End of your rest time, do the last ${repsToSay} ${
                    reps === 1 ? 'repetition' : 'repetitions'
                  } of ${name} and your workout will be complete! If you enjoyed this workout, don't forget to rate us with 5 stars. Thank you!</amazon:emotion></speak>`,
            },
          ],
        },
      },
      pushNotification: {
        status: 'DISABLED',
      },
    };

    try {
      const reminderResponse = await reminderApiClient.createReminder(
        reminderRequest
      );
      lastReminderToken = reminderResponse.alertToken;
    } catch (error) {
      // No permissions to create reminders
      console.error('@@@ error creating reminder:', error);

      return handlerInput.responseBuilder
        .speak(
          '<amazon:emotion name="disappointed" intensity="high">Sorry, it seems you haven\'t granted the necessary permissions for me to create reminders. Please grant the permission in the Alexa app. Then, just say: Alexa, ask My Workout to continue. Or if you prefer, start a new workout.</amazon:emotion>'
        )
        .getResponse();
    }

    // Reminder created
    if (!isLastExercise) {
      const speakOutput = `<amazon:emotion name="excited" intensity="high">${
        randomReminderInitial[
          Math.floor(Math.random() * randomReminderInitial.length)
        ]
      }! ${
        randomReminder[Math.floor(Math.random() * randomReminder.length)]
      }. <break time="0.2s" /><break time="0.5s" />${
        !shouldSkipMotivation
          ? randomTip[Math.floor(Math.random() * randomTip.length)]
          : ''
      }.</amazon:emotion>`;

      return handlerInput.responseBuilder.speak(speakOutput).getResponse();
    } else {
      const speakOutput = `<amazon:emotion name="excited" intensity="high">${
        randomReminderInitial[
          Math.floor(Math.random() * randomReminderInitial.length)
        ]
      }! ${
        randomReminder[Math.floor(Math.random() * randomReminder.length)]
      }. <break time="0.2s" /><break time="0.5s" />The next set will be the last of your workout.</amazon:emotion>`;

      cleanup();
      prevExercises = null;
      isLastExercise = null;
      currentExerciseCounter = 0;

      return handlerInput.responseBuilder
        .speak(speakOutput)
        .withShouldEndSession(true)
        .getResponse();
    }
  },
};

const ContinueTrainingIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) ===
        'ContinueTrainingIntent'
    );
  },
  handle(handlerInput) {
    cleanLastTimer(handlerInput);

    if (prevExercises) {
      exercises = prevExercises;
      prevExercises = null;
    } else {
      const speakOutput = `There's no workout on hold to resume. If you asked for a rest in your current workout, please ask me again because I misunderstood.`;

      return handlerInput.responseBuilder.speak(speakOutput).getResponse();
    }

    const { name, currentSerie } = currentExercise;
    const speakOutput = `Let's continue with the workout! <break time="0.2s" /> Proceed to set ${currentSerie} of ${name}`;

    return handlerInput.responseBuilder.speak(speakOutput).getResponse();
  },
};

const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return (
      (Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
        (Alexa.getIntentName(handlerInput.requestEnvelope) ===
          'AMAZON.CancelIntent' ||
          Alexa.getIntentName(handlerInput.requestEnvelope) ===
            'AMAZON.StopIntent')) ||
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'EndTrainingIntent'
    );
  },
  async handle(handlerInput) {
    if (
      !exercises &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'EndTrainingIntent'
    ) {
      const speakOutput =
        '<amazon:emotion name="disappointed" intensity="high">Oops, it seems there is no workout in progress. To start a new workout, say: Alexa, begin my workout.</amazon:emotion>';

      cleanLastTimer(handlerInput);

      return handlerInput.responseBuilder.speak(speakOutput).getResponse();
    }

    cleanup();
    cleanLastTimer(handlerInput);

    const speakOutput =
      '<amazon:emotion name="disappointed" intensity="high">Finishing your workout. If you want to resume it, say: Alexa, ask My Workout to continue.</amazon:emotion>';
    return handlerInput.responseBuilder
      .speak(speakOutput)
      .withShouldEndSession(true)
      .getResponse();
  },
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) ===
      'SessionEndedRequest'
    );
  },
  handle(handlerInput) {
    cleanup();

    return handlerInput.responseBuilder.getResponse();
  },
};

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent'
    );
  },
  handle(handlerInput) {
    const speakOutput =
      '<amazon:emotion name="excited" intensity="high">Start by asking me to start your workout. Then, choose one of the valid options. From there on, whenever you finish a set of your exercise, ask me for a break by saying: Alexa, rest in My Workout. If you want to start a new workout now, just ask me.</amazon:emotion>';

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt(
        'Are you still there? If you want to work out, ask me to start your workout.'
      )
      .getResponse();
  },
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    let speakOutput;

    if (
      error.stack.match(/Error: Unable to find a suitable request handler/gi)
    ) {
      speakOutput = `<amazon:emotion name="disappointed" intensity="high">Sorry, can you repeat that?</amazon:emotion>`;

      return handlerInput.responseBuilder
        .speak(speakOutput)
        .reprompt(speakOutput)
        .getResponse();
    }

    console.error('@@@ error:', error);

    speakOutput = `<amazon:emotion name="disappointed" intensity="high">Sorry, I couldn't understand what you said. If you were trying to start a workout, remember to say the full name, for example: Workout A.</amazon:emotion>`;

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .withShouldEndSession(true)
      .getResponse();
  },
};

exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    StartTrainingIntentHandler,
    IntervalIntentHandler,
    ContinueTrainingIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    SessionEndedRequestHandler
  )
  .addErrorHandlers(ErrorHandler)
  .withApiClient(new Alexa.DefaultApiClient())
  .lambda();
