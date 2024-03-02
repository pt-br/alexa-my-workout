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
      const speechOutput = `<amazon:emotion name="disappointed" intensity="high">Desculpe, parece que você não concedeu as permissões necessárias para que eu acesse e crie notas na sua lista de tarefas e crie lembretes. Por favor, conceda as permissões e me chame novamente. Se tiver alguma dúvida, siga as instruções que estão na página da Skill.</amazon:emotion>`;
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
        '<amazon:emotion name="disappointed" intensity="high">Desculpe, parece que você não concedeu as permissões necessárias para que eu identifique o seu endereço de email. Por favor, conceda a permissão no aplicativo Alexa no seu celular e me chame novamente.</amazon:emotion>';

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
        '<amazon:emotion name="disappointed" intensity="high">Olá! Houve um erro ao sincronizar os seus treinos com o meutreino.fit. Por favor, tente iniciar o seu treino novamente!</amazon:emotion>';

      return handlerInput.responseBuilder
        .speak(speechOutput)
        .withShouldEndSession(true)
        .getResponse();
    }

    if (workoutsFetching === 'NO_TRAININGS') {
      const speechOutput =
        '<amazon:emotion name="disappointed" intensity="high">Olá, seja muito bem-vindo ao Meu Treino! Parece que você ainda não tem um cadastro ou ainda não criou nenhum treino no meutreino.fit. Por favor, acesse meutreino.fit, monte seus treinos com a ajuda da nossa inteligência artificial e me chame novamente!</amazon:emotion>';

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
    let stateListId = await getListId(handlerInput, 'Meu_Treino_Internal');

    if (!stateListId) {
      isFirstTraining = true;

      await listClient.createList({
        name: 'Meu_Treino_Internal',
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

    const savedTrainingsSpeech = `<break time="0.3s" />Você possui ${
      workouts.length
    } ${workouts.length === 1 ? 'treino' : 'treinos'} ${
      workouts.length === 1 ? 'disponível' : 'disponíveis'
    }: ${
      workoutNames.length > 1
        ? workoutNames
            .slice(0, -1)
            .map((name) => `Treino ${name} <break time="0.1s" />`)
            .join(', ') + ` e Treino ${workoutNames.slice(-1)[0]}`
        : `Treino ${workoutNames[0]}`
    }<break time="0.2s" />`;

    if (isFirstTraining) {
      const speechOutput = `<amazon:emotion name="excited" intensity="high">Olá ${personName}! Seja bem-vindo ao seu primeiro treino! ${savedTrainingsSpeech}. Qual treino deseja iniciar?</amazon:emotion>`;
      return handlerInput.responseBuilder
        .speak(speechOutput)
        .reprompt(
          '<amazon:emotion name="excited" intensity="high">Você tá aí? Qual dos treinos quer iniciar?</amazon:emotion>'
        )
        .getResponse();
    } else {
      const speechOutput = `<amazon:emotion name="excited" intensity="high">Olá ${personName}, bem-vindo de volta ao Meu Treino, ou melhor, o seu treino! ${savedTrainingsSpeech}. Qual treino deseja iniciar?</amazon:emotion>`;
      return handlerInput.responseBuilder
        .speak(speechOutput)
        .reprompt(
          '<amazon:emotion name="excited" intensity="high">Você tá aí? Qual dos treinos quer iniciar?</amazon:emotion>'
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
    let stateListId = await getListId(handlerInput, 'Meu_Treino_Internal');

    const workoutNames = workouts.map((workout) => workout.attributes.name); // for the error message
    const invalidTrainingSpeech = `${
      workoutNames.length > 1
        ? workoutNames
            .slice(0, -1)
            .map((name) => `Treino ${name}`)
            .join(', ') + ` e Treino ${workoutNames.slice(-1)[0]}`
        : `Treino ${workoutNames[0]}`
    }.<break time="0.2s" />`;

    selectedWorkout = workouts.find(
      (workout) => workout.attributes.name === value.toUpperCase()
    );

    /**
     * Invalid workout name (asking for a training name that doesn't exist)
     */
    if (!selectedWorkout) {
      const speakOutput = `<amazon:emotion name="excited" intensity="high">O treino ${value} não está salvo nas suas notas. Escolha um treino válido, como: ${invalidTrainingSpeech}</amazon:emotion>`;
      return handlerInput.responseBuilder
        .speak(speakOutput)
        .reprompt(
          `<amazon:emotion name="excited" intensity="high">Você ainda tá por aí? Se ainda quiser treinar, escolha um treino válido, como: ${invalidTrainingSpeech}</amazon:emotion>`
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
      const speechOutput = `<amazon:emotion name="disappointed" intensity="high">Parece que você ainda não adicionou nenhum exercício no seu ${workoutDescription}. Por favor, acesse meutreino.fit e adicione exercícios no seu treino.</amazon:emotion>`;

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
              ? `${exercise.interval} segundo${
                  exercise.interval !== 1 ? 's' : ''
                }`
              : `${Math.floor(exercise.interval / 60)} minuto${
                  Math.floor(exercise.interval / 60) !== 1 ? 's' : ''
                }${
                  Math.floor(exercise.interval / 60) !== 0 &&
                  exercise.interval % 60 !== 0
                    ? ' e '
                    : ''
                }${
                  exercise.interval % 60 !== 0
                    ? `${exercise.interval % 60} segundo${
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
      name: 'Meu_Treino_Internal',
      state: listStatuses.ACTIVE,
    });

    stateListId = await getListId(handlerInput, 'Meu_Treino_Internal'); // get the updated list id

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
      'Vamos começar',
      'Vamos lá',
      'Vamos nessa',
      'Bora começar',
      'Bora lá',
    ];

    const randomConfirmation = [
      `Certo, ${workoutDescription}`,
      `Iniciando o ${workoutDescription}`,
      `${workoutDescription} então`,
      `Tudo certo pro seu ${workoutDescription}`,
      `Ok, ${workoutDescription}`,
    ];

    const seriesToSay = series === 1 ? 'uma' : series === 2 ? 'duas' : series;
    const repsToSay = reps === 1 ? 'uma' : reps === 2 ? 'duas' : reps;

    let exerciseSpeech = '';

    if (howTo) {
      exerciseSpeech = `<break time="0.2s" />O seu primeiro exercício é ${name}.<break time="0.2s" /> Você fará ${seriesToSay} ${
        series === 1 ? 'série' : 'séries'
      } di ${repsToSay} ${
        reps === 1 ? 'repetição' : 'repetições'
      }.<break time="0.2s" /> ${howTo}<break time="0.2s" /> ${
        isFirstTraining
          ? `Você precisa me informar toda vez que concluir uma série.<break time="0.2s" /> Para isso, é só falar: Alexa, intervalo no meu treino.<break time="0.2s" /> Dessa forma saberei quando lhe avisar para dar seguimento ao treino.<break time="0.2s" /> Pode começar a sua primeira série de ${name} e quando terminá-la, diga: Alexa, intervalo no meu treino.`
          : `Pode começar a sua primeira série de ${name}, e quando terminar, me informe dizendo: Alexa, intervalo no meu treino.`
      }`;
    } else {
      exerciseSpeech = `<break time="0.2s" />O seu primeiro exercício é ${name}.<break time="0.2s" /> Você fará ${seriesToSay} ${
        series === 1 ? 'série' : 'séries'
      } di ${repsToSay} ${
        reps === 1 ? 'repetição' : 'repetições'
      }.<break time="0.2s" /> ${
        isFirstTraining
          ? `Você precisa me informar toda vez que concluir uma série.<break time="0.2s" /> Para isso, é só falar: Alexa, intervalo no meu treino.<break time="0.2s" /> Dessa forma saberei quando lhe avisar para dar seguimento ao treino.<break time="0.2s" /> Pode começar a sua primeira série de ${name} e quando terminá-la, diga: Alexa, intervalo no meu treino.`
          : `Pode começar a sua primeira série de ${name}, e quando terminar, me informe dizendo: Alexa, intervalo no meu treino.`
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
    let stateListId = await getListId(handlerInput, 'Meu_Treino_Internal');
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
          '<amazon:emotion name="disappointed" intensity="high">Ops, parece que não há um treino em andamento. Para iniciar um novo treino, diga: Alexa, começa meu treino.</amazon:emotion>';

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
        shouldSkipMotivationListItem
          .value
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
          '<amazon:emotion name="disappointed" intensity="high">Desculpe, parece que você não concedeu as permissões necessárias para que eu identifique o seu endereço de email. Por favor, conceda a permissão no aplicativo Alexa no seu celular e me chame novamente.</amazon:emotion>';

        return handlerInput.responseBuilder
          .speak(speechOutput)
          .withShouldEndSession(true)
          .getResponse();
      }

      const currentWorkoutIdFromList = currentWorkoutIdListItem
        .value
        .replace('CURRENT_WORKOUT_ID=', '');

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

      const currentExerciseName = currentExerciseListItem
        .value
        .replace('CURRENT_EXERCISE_NAME=', '');

      const currentSerieListItem = list.items.find((note) =>
        note.value.match(/CURRENT_SERIE/gi)
      );

      const currentSerieListValue = currentSerieListItem
        .value
        .replace('CURRENT_SERIE=', '');

      exercises = selectedWorkout.attributes.exercises.map((exercise) => {
        return {
          name: exercise.name,
          reps: parseInt(exercise.reps, 10),
          series: parseInt(exercise.series, 10),
          howTo: exercise.howTo ? exercise.howTo : '',
          interval: {
            name:
              exercise.interval < 60
                ? `${exercise.interval} segundo${
                    exercise.interval !== 1 ? 's' : ''
                  }`
                : `${Math.floor(exercise.interval / 60)} minuto${
                    Math.floor(exercise.interval / 60) !== 1 ? 's' : ''
                  }${
                    Math.floor(exercise.interval / 60) !== 0 &&
                    exercise.interval % 60 !== 0
                      ? ' e '
                      : ''
                  }${
                    exercise.interval % 60 !== 0
                      ? `${exercise.interval % 60} segundo${
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
      name: 'Meu_Treino_Internal',
      state: listStatuses.ACTIVE,
    });

    stateListId = await getListId(handlerInput, 'Meu_Treino_Internal'); // get the updated list id

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
      'Ok',
      'Certo',
      'Beleza',
      'Tudo bem',
      'Pode deixar',
      'Deixa comigo',
      'Show',
      'Tá bom',
      'Entendido',
    ];

    const randomReminder = [
      `Vou te lembrar de retomar a sua série em ${intervalToSet.name}`,
      `Daqui a ${intervalToSet.name} eu te aviso`,
      `Em ${intervalToSet.name} voltaremos com a próxima série`,
      `Daqui a ${intervalToSet.name} a gente continua`,
      `Te aviso em ${intervalToSet.name}`,
    ];

    const randomTip = [
      'Aproveite para se hidratar se você estiver com sede',
      'Lembre-se de aumentar a intensidade ou a carga do seu exercício se estiver muito fácil',
      'Respire corretamente durante as séries, isso vai aliviar a pressão do seu corpo durante execução dos exercícios',
      'Tenha uma alimentação saudável e siga uma dieta balanceada para complementar o seu treino',
      'Lembre-se que é importante que o seu descanso seja compatível com o esforço, portanto tire dias para descansar',
      'Cuidado com a sua postura durante a execução dos exercícios',
      'Vamos lá, falta pouco agora!',
      'Você está indo muito bem, continua assim!',
      'Tô gostando de ver!',
      'Acredite em si mesmo, você é mais forte do que pensa!',
      'Cada gota de suor é um passo mais próximo do seu objetivo!',
      'O sucesso vem para aqueles que se esforçam e persistem!',
      'Não desista, o que hoje parece impossível, amanhã será apenas mais uma conquista!',
      'Seja consistente e os resultados virão!',
      'Você é capaz de superar qualquer desafio que aparecer no seu caminho!',
      'O caminho para o sucesso é pavimentado com dedicação e determinação!',
      'Nunca subestime o poder da sua mente para transformar seus sonhos em realidade!',
      'O impossível só existe até que alguém decida torná-lo possível!',
      'Lembre-se que o importante é progredir, não importa o quão devagar você vá!',
      'Cada dia é uma nova oportunidade para melhorar!',
      'Não deixe que o medo de falhar o impeça de tentar!',
      'A jornada do sucesso começa com um simples passo!',
      'O sucesso não é um destino, é uma jornada!',
      'As pequenas vitórias são tão importantes quanto as grandes!',
      'Não compare seu progresso com o dos outros, compare com o seu próprio ontem!',
      'O fracasso é apenas uma oportunidade para recomeçar com mais sabedoria!',
      'Você é mais corajoso do que pensa, mais forte do que imagina e mais capaz do que acredita!',
      'Se você quer algo que nunca teve, precisa fazer algo que nunca fez!',
      'A dor que você sente hoje será a força que você sentirá amanhã!',
      'Não existe elevador para o sucesso, você precisa subir degrau por degrau!',
      'Não deixe para amanhã o que você pode começar hoje!',
      'O sucesso é a soma de pequenos esforços repetidos dia após dia!',
      'Você não pode mudar o vento, mas pode ajustar as velas do barco!',
      'O segredo do sucesso é a constância do propósito!',
      'Acredite em você mesmo e tudo será possível!',
      'Não espere por oportunidades, crie-as!',
      'A disciplina é a ponte entre metas e realizações!',
      'Não existe vitória sem luta!',
      'O maior obstáculo para o sucesso é o medo do fracasso!',
      'Não importa o quão devagar você vá, desde que você não pare!',
      'O que você faz hoje pode melhorar todos os seus amanhãs!',
      'O tempo é precioso, não o desperdice, invista em você!',
      'O sucesso não é o resultado de um esforço único, é o resultado de um compromisso constante!',
      'Não deixe que a vontade de desistir seja maior do que a vontade de continuar!',
      'Não pare até se orgulhar de onde você chegou!',
      'Transforme cada obstáculo em uma oportunidade de crescimento!',
      'O que você alcançará amanhã, começa com o que você faz hoje!',
      'Não adie seus sonhos, comece agora!',
      'A jornada pode ser difícil, mas a chegada valerá a pena!',
      'Pare de se preocupar com o que pode dar errado e comece a se concentrar no que pode dar certo!',
      'Você é mais forte do que pensa, mais corajoso do que acredita e mais talentoso do que imagina!',
      'O sucesso não é para os rápidos, mas para os persistentes!',
    ];

    const seriesToSay = series === 1 ? 'uma' : series === 2 ? 'duas' : series;
    const repsToSay = reps === 1 ? 'uma' : reps === 2 ? 'duas' : reps;

    let intervalToSay;

    if (currentSerie === 1) {
      intervalToSay = `<speak><amazon:emotion name="excited" intensity="high">Fim do seu intervalo. Vamos para a primeira série de ${name}. Você fará ${seriesToSay} ${
        series === 1 ? 'série' : 'séries'
      } di ${repsToSay} ${
        reps === 1 ? 'repetição' : 'repetições'
      }.<break time="0.2s" /> ${
        howTo ? howTo : ''
      }. Pode começar a sua primeira série de ${name}.</amazon:emotion></speak>`;
    } else {
      intervalToSay = `<speak><amazon:emotion name="excited" intensity="high">Fim do seu intervalo, continue para a série ${currentSerie} de ${name}, fazendo mais ${repsToSay} ${
        reps === 1 ? 'repetição' : 'repetições'
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
              locale: 'pt-BR',
              text: 'Intervalo do Meu Treino',
              ssml: !isLastExercise
                ? intervalToSay
                : `<speak><amazon:emotion name="excited" intensity="high">Fim do seu intervalo, faça as últimas ${repsToSay} ${
                    reps === 1 ? 'repetição' : 'repetições'
                  } de ${name} e seu treino estará terminado! Se você gostou desse treino, não esqueça de nos avaliar com 5 estrelas. Obrigada!</amazon:emotion></speak>`,
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
          '<amazon:emotion name="disappointed" intensity="high">Desculpe, parece que você não concedeu as permissões necessárias para que eu crie lembretes. Por favor, conceda a permissão no aplicativo Alexa. Depois, é só falar: Alexa, pede pro Meu Treino continuar. Ou se preferir, comece um novo treino.</amazon:emotion>'
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
      }. <break time="0.2s" /><break time="0.5s" />A próxima série será a última do seu treino.</amazon:emotion>`;

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
      const speakOutput = `Não há um treino em espera para retomar. Se você me pediu um intervalo no seu treino atual, por favor, me peça novamente pois entendi errado.`;

      return handlerInput.responseBuilder.speak(speakOutput).getResponse();
    }

    const { name, currentSerie } = currentExercise;
    const speakOutput = `Vamos continuar com o treino! <break time="0.2s" /> Continue para a série ${currentSerie} de ${name}`;

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
        '<amazon:emotion name="disappointed" intensity="high">Ops, parece que não há um treino em andamento. Para iniciar um novo treino, diga: Alexa, começa meu treino.</amazon:emotion>';

      cleanLastTimer(handlerInput);

      return handlerInput.responseBuilder.speak(speakOutput).getResponse();
    }

    cleanup();
    cleanLastTimer(handlerInput);

    const speakOutput =
      '<amazon:emotion name="disappointed" intensity="high">Terminando o seu treino. Se quiser retomá-lo, diga: Alexa, pede pro Meu Treino continuar. </amazon:emotion>';
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
      '<amazon:emotion name="excited" intensity="high">Comece me pedindo para começar o seu treino. Em seguida, escolha entre uma das opções válidas. Daí em frente, sempre que terminar uma série do seu exercício, me peça um intervalo dizendo: Alexa, intervalo no Meu Treino. Se quiser começar um novo treino agora, é só me pedir.</amazon:emotion>';

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt(
        'Você ainda tá por aí? Se quiser treinar, me pede para começar o seu treino.'
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
      speakOutput = `<amazon:emotion name="disappointed" intensity="high">Desculpa, pode repetir?</amazon:emotion>`;

      return handlerInput.responseBuilder
        .speak(speakOutput)
        .reprompt(speakOutput)
        .getResponse();
    }

    console.error('@@@ error:', error);

    speakOutput = `<amazon:emotion name="disappointed" intensity="high">Desculpa, não consegui entender o que você disse. Se você tentou iniciar um treino, lembre-se de falar o nome completo, por exemplo: Treino A.</amazon:emotion>`;

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
