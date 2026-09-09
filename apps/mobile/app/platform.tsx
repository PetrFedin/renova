import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { QrCodeImage } from '@/components/renova/QrCodeImage';
import { Card, StatusPill } from '@/components/ui';
import { reportCatch } from '@/lib/reportError';
import { resolveCanonicalPlatformUrl, resolvePlatformContactUrl } from '@/lib/platformPresentation';

type IconName = ComponentProps<typeof Ionicons>['name'];

type FlowStep = {
  index: string;
  icon: IconName;
  title: string;
  text: string;
};

type FeatureBlock = {
  icon: IconName;
  title: string;
  text: string;
};

const FLOW_STEPS: FlowStep[] = [
  {
    index: '01',
    icon: 'home-outline',
    title: 'Объект и помещения',
    text: 'Единый проект: параметры объекта, комнаты, исходные данные и контекст ремонта.',
  },
  {
    index: '02',
    icon: 'calculator-outline',
    title: 'Смета и изменения',
    text: 'План стоимости, строки сметы и изменения объёма не смешиваются с фактическими расходами и оплатами.',
  },
  {
    index: '03',
    icon: 'calendar-outline',
    title: 'Сроки и работы',
    text: 'Этапы, работы, зависимости, сроки и факт исполнения связываются с конкретным проектом.',
  },
  {
    index: '04',
    icon: 'cube-outline',
    title: 'Материалы и закупки',
    text: 'Потребность, выбор, закупка, поставка и подтверждающие данные проходят отдельный жизненный цикл.',
  },
  {
    index: '05',
    icon: 'chatbubbles-outline',
    title: 'Коммуникация и контроль',
    text: 'Чаты, комментарии, фото, согласования и технический контроль остаются в контексте объекта.',
  },
  {
    index: '06',
    icon: 'checkmark-done-outline',
    title: 'Приёмка и доработки',
    text: 'Выполнение работы, её приёмка, замечания и устранение дефектов — разные управляемые состояния.',
  },
  {
    index: '07',
    icon: 'wallet-outline',
    title: 'Деньги и документы',
    text: 'Смета, обязательство, расход, платёж и доказательство платежа не подменяют друг друга.',
  },
  {
    index: '08',
    icon: 'shield-checkmark-outline',
    title: 'Завершение и гарантия',
    text: 'Закрытие проекта продолжается историей приёмки, гарантий, документов, архива и правил хранения.',
  },
];

const FEATURE_BLOCKS: FeatureBlock[] = [
  {
    icon: 'layers-outline',
    title: 'Единая модель объекта',
    text: 'Project связывает помещения, смету, этапы, участников, материалы, финансы, документы и историю.',
  },
  {
    icon: 'construct-outline',
    title: 'Исполнение',
    text: 'Этапы, Work Order, расписание, зависимости, фото и комментарии формируют проверяемый контур работ.',
  },
  {
    icon: 'cart-outline',
    title: 'Закупки',
    text: 'Material Pick, Purchase и Purchase Item отделяют потребность от фактической закупочной операции.',
  },
  {
    icon: 'cash-outline',
    title: 'Финансовая правда',
    text: 'Estimate, Change Order, Expense, Payment и Receipt/evidence имеют отдельный экономический смысл.',
  },
  {
    icon: 'documents-outline',
    title: 'Документы и взаимодействие',
    text: 'Версии документов, согласования, чат, уведомления и роли связываются с проектом и правами доступа.',
  },
  {
    icon: 'git-network-outline',
    title: 'Надёжность операций',
    text: 'Транзакции, audit, Domain Outbox, worker, reconciliation и recovery образуют отдельный системный слой.',
  },
];

const ROLE_BLOCKS = [
  {
    icon: 'person-outline' as const,
    title: 'Заказчик',
    text: 'Видит объект, бюджет, сроки, согласования, ход работ, приёмку, деньги и документы в одном контексте.',
  },
  {
    icon: 'hammer-outline' as const,
    title: 'Исполнитель',
    text: 'Работает с назначенным объёмом, этапами, материалами, подтверждениями выполнения и расчётами в пределах прав.',
  },
  {
    icon: 'eye-outline' as const,
    title: 'Технический надзор',
    text: 'Получает отдельный контур контроля качества, доказательств, замечаний и решений без подмены роли заказчика.',
  },
  {
    icon: 'people-outline' as const,
    title: 'Команда и участники',
    text: 'Viewer, team и project participant работают через явные роли и scope; полная multi-contractor модель ещё доводится.',
  },
];

const INVESTMENT_THESIS = [
  {
    icon: 'share-social-outline' as const,
    title: 'Связанный граф ремонта',
    text: 'Ценность создаётся не количеством экранов, а связью между планом, исполнением, деньгами, доказательствами и итогом.',
  },
  {
    icon: 'repeat-outline' as const,
    title: 'Повторяемый lifecycle',
    text: 'Один доменный каркас применим к последовательным проектам и ролям без создания отдельной системы на каждый сценарий.',
  },
  {
    icon: 'extension-puzzle-outline' as const,
    title: 'Provider-independent core',
    text: 'Внешние платежные, налоговые, подписные и другие сервисы подключаются через границы, не становясь источником истины ремонта.',
  },
  {
    icon: 'analytics-outline' as const,
    title: 'Основа для аналитики',
    text: 'Структурированные события и состояния создают базу для управленческой аналитики после квалификации качества данных.',
  },
];

const ARCHITECTURE_LAYERS = [
  ['Mobile / Web', 'Expo + React Native + expo-router'],
  ['API / Auth / ACL', 'FastAPI, роли и project/resource scope'],
  ['Authoritative state', 'PostgreSQL — долговременный источник истины'],
  ['Reliability', 'Redis + транзакции + audit + Domain Outbox'],
  ['Execution', 'Dedicated worker + retry / reconciliation / recovery'],
  ['Files', 'S3-compatible private object storage'],
  ['External systems', 'Только через документированные provider / partner boundaries'],
] as const;

const IMPLEMENTED_CORE = [
  'объект и помещения',
  'смета и этапы',
  'закупки и расходы',
  'платежи и документы',
  'чат и согласования',
  'технический надзор',
];

const HARDENING_SCOPE = [
  'session / account fencing',
  'idempotency и offline replay',
  'cache / transport provenance',
  'финансовая аналитика',
  'purge / retention',
  'native file delivery',
  'полный multi-contractor journey',
];

function Section({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.sectionTitle}>{title}</Text>
      {lead ? <Text style={styles.sectionLead}>{lead}</Text> : null}
      {children}
    </View>
  );
}

function IconBubble({ name }: { name: IconName }) {
  return (
    <View style={styles.iconBubble}>
      <Ionicons name={name} size={20} color={RenovaTheme.colors.accent} />
    </View>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <View style={styles.bulletRow}>
      <Ionicons name="checkmark-circle-outline" size={18} color={RenovaTheme.colors.success} />
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

export default function PlatformPresentationRoute() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [runtimeOrigin, setRuntimeOrigin] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    setRuntimeOrigin(window.location.origin);
    document.title = 'Renova — платформа управления ремонтом';
  }, []);

  const canonicalUrl = useMemo(
    () => resolveCanonicalPlatformUrl(process.env.EXPO_PUBLIC_PLATFORM_URL, runtimeOrigin),
    [runtimeOrigin],
  );
  const contactUrl = useMemo(
    () => resolvePlatformContactUrl(process.env.EXPO_PUBLIC_PLATFORM_CONTACT_URL),
    [],
  );

  const openContact = () => {
    if (!contactUrl) return;
    Linking.openURL(contactUrl).catch(reportCatch('platform.contact'));
  };

  const openRepository = () => {
    Linking.openURL('https://github.com/PetrFedin/renova').catch(reportCatch('platform.repository'));
  };

  const openSpecification = () => {
    Linking.openURL('https://github.com/PetrFedin/renova/blob/main/docs/RENOVA-TECHNICAL-SPECIFICATION.md')
      .catch(reportCatch('platform.specification'));
  };

  const cardWidth = wide ? '31.5%' : '100%';
  const halfCardWidth = wide ? '48.8%' : '100%';
  const flowCardWidth = wide ? '23.7%' : '100%';

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
      <View style={styles.shell}>
        <View style={styles.topbar}>
          <View>
            <Text style={styles.brand}>RENOVA</Text>
            <Text style={styles.brandSub}>PLATFORM BRIEF</Text>
          </View>
          <StatusPill label="ПУБЛИЧНЫЙ ОБЗОР" tone="info" />
        </View>

        <View style={[styles.hero, { flexDirection: wide ? 'row' : 'column' }]}>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>ОПЕРАЦИОННАЯ СИСТЕМА РЕМОНТА</Text>
            <Text accessibilityRole="header" style={styles.heroTitle}>
              Renova объединяет ремонт в один управляемый процесс
            </Text>
            <Text style={styles.heroLead}>
              От объекта и сметы до работ, материалов, приёмки, денег, документов и гарантии —
              в одной связанной системе для заказчика, исполнителя и контроля.
            </Text>

            <View style={[styles.ctaRow, { flexDirection: wide ? 'row' : 'column' }]}>
              <View style={wide ? styles.ctaWide : styles.ctaFull}>
                <PrimaryButton
                  title="Открыть платформу"
                  size="lg"
                  fullWidth
                  onPress={() => router.push('/onboarding/role')}
                  accessibilityHint="Перейти к выбору роли в Renova"
                />
              </View>
              {contactUrl ? (
                <View style={wide ? styles.ctaWide : styles.ctaFull}>
                  <PrimaryButton
                    title="Партнёрство / инвестиции"
                    variant="outline"
                    size="lg"
                    fullWidth
                    onPress={openContact}
                  />
                </View>
              ) : null}
            </View>

            <View style={styles.heroFacts}>
              <View style={styles.heroFact}>
                <Text style={styles.heroFactLabel}>Фокус</Text>
                <Text style={styles.heroFactValue}>реальный lifecycle ремонта</Text>
              </View>
              <View style={styles.heroFact}>
                <Text style={styles.heroFactLabel}>Источник истины</Text>
                <Text style={styles.heroFactValue}>связанные доменные данные</Text>
              </View>
              <View style={styles.heroFact}>
                <Text style={styles.heroFactLabel}>Контроль</Text>
                <Text style={styles.heroFactValue}>роли · audit · recovery</Text>
              </View>
            </View>
          </View>

          <View style={styles.heroVisualWrap}>
            <Card style={styles.heroVisualCard}>
              <View style={styles.visualHeader}>
                <View>
                  <Text style={styles.visualEyebrow}>PROJECT CONTROL</Text>
                  <Text style={styles.visualTitle}>Один объект — одна история решений</Text>
                </View>
                <Ionicons name="git-network-outline" size={28} color={RenovaTheme.colors.accent} />
              </View>
              <View style={styles.controlRow}>
                <Text style={styles.controlLabel}>Объём</Text>
                <StatusPill label="СМЕТА + CHANGE" tone="info" />
              </View>
              <View style={styles.controlRow}>
                <Text style={styles.controlLabel}>Исполнение</Text>
                <StatusPill label="ЭТАПЫ + РАБОТЫ" tone="success" />
              </View>
              <View style={styles.controlRow}>
                <Text style={styles.controlLabel}>Материалы</Text>
                <StatusPill label="ПОТРЕБНОСТЬ → ЗАКУПКА" tone="neutral" />
              </View>
              <View style={styles.controlRow}>
                <Text style={styles.controlLabel}>Контроль</Text>
                <StatusPill label="ПРИЁМКА + ДОКАЗАТЕЛЬСТВА" tone="warning" />
              </View>
              <View style={styles.controlRow}>
                <Text style={styles.controlLabel}>Финансы</Text>
                <StatusPill label="РАСХОД ≠ ПЛАТЁЖ" tone="neutral" />
              </View>
              <View style={styles.visualFooter}>
                <Ionicons name="shield-checkmark-outline" size={17} color={RenovaTheme.colors.primaryMuted} />
                <Text style={styles.visualFooterText}>
                  Критические состояния не сводятся к одной «галочке»: план, факт, приёмка и деньги имеют отдельный смысл.
                </Text>
              </View>
            </Card>
          </View>
        </View>

        <Section
          eyebrow="ПРОБЛЕМА, КОТОРУЮ РЕШАЕТ ПРОДУКТ"
          title="Одна картина вместо фрагментов"
          lead="Renova проектируется вокруг результата ремонта: не отдельного чата, сметы или календаря, а их согласованной связи."
        >
          <View style={[styles.grid, { gap: RenovaTheme.spacing.md }]}>
            {[
              ['copy-outline', 'Один объект', 'Данные проекта не должны жить в несвязанных таблицах, переписках и файлах.'],
              ['link-outline', 'Один контекст', 'Решение, работа, документ, расход и доказательство сохраняют связь с причиной и объектом.'],
              ['lock-closed-outline', 'Явные права', 'Роль сама по себе не даёт доступ ко всему проекту: важен project/resource scope.'],
              ['refresh-outline', 'Восстановление', 'Повтор, сбой сети или провайдера рассматриваются как нормальные сценарии системы, а не исключение из модели.'],
            ].map(([icon, title, text]) => (
              <Card key={title} style={{ ...styles.infoCard, width: halfCardWidth }}>
                <IconBubble name={icon as IconName} />
                <Text style={styles.cardTitle}>{title}</Text>
                <Text style={styles.cardText}>{text}</Text>
              </Card>
            ))}
          </View>
        </Section>

        <Section
          eyebrow="END-TO-END"
          title="Сквозной процесс"
          lead="Каждый этап имеет собственные состояния, права, доказательства и связи с соседними доменами."
        >
          <View style={[styles.grid, { gap: RenovaTheme.spacing.sm }]}>
            {FLOW_STEPS.map((item) => (
              <Card key={item.index} style={{ ...styles.flowCard, width: flowCardWidth }}>
                <View style={styles.flowTop}>
                  <Text style={styles.flowIndex}>{item.index}</Text>
                  <IconBubble name={item.icon} />
                </View>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardText}>{item.text}</Text>
              </Card>
            ))}
          </View>
        </Section>

        <Section
          eyebrow="PRODUCT CORE"
          title="Что внутри платформы"
          lead="Renova уже имеет существенное реализованное ядро. Оно строится как связанная система доменов, а не набор независимых экранов."
        >
          <View style={[styles.grid, { gap: RenovaTheme.spacing.md }]}>
            {FEATURE_BLOCKS.map((item) => (
              <Card key={item.title} style={{ ...styles.featureCard, width: cardWidth }}>
                <IconBubble name={item.icon} />
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardText}>{item.text}</Text>
              </Card>
            ))}
          </View>
        </Section>

        <Section
          eyebrow="РОЛИ"
          title="Один проект — разные рабочие контуры"
          lead="Платформа различает интересы заказчика, исполнителя, технического контроля и других участников вместо общего неограниченного доступа."
        >
          <View style={[styles.grid, { gap: RenovaTheme.spacing.md }]}>
            {ROLE_BLOCKS.map((item) => (
              <Card key={item.title} style={{ ...styles.roleCard, width: halfCardWidth }}>
                <View style={styles.roleHeader}>
                  <IconBubble name={item.icon} />
                  <Text style={styles.cardTitle}>{item.title}</Text>
                </View>
                <Text style={styles.cardText}>{item.text}</Text>
              </Card>
            ))}
          </View>
        </Section>

        <Section
          eyebrow="PRODUCT / INVESTMENT THESIS"
          title="Почему это может становиться платформой, а не ещё одним приложением"
          lead="Ниже — продуктовая инвестиционная логика архитектуры Renova. Это не оценка рынка, не финансовый прогноз и не обещание ROI."
        >
          <View style={[styles.grid, { gap: RenovaTheme.spacing.md }]}>
            {INVESTMENT_THESIS.map((item) => (
              <Card key={item.title} style={{ ...styles.featureCard, width: halfCardWidth }}>
                <IconBubble name={item.icon} />
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardText}>{item.text}</Text>
              </Card>
            ))}
          </View>
        </Section>

        <Section
          eyebrow="ARCHITECTURE"
          title="Доменная правда отделена от внешних провайдеров"
          lead="Production-oriented topology Renova использует PostgreSQL как authoritative state, отдельный worker для durable background work и явные границы внешних интеграций."
        >
          <View style={[styles.architectureGrid, { flexDirection: wide ? 'row' : 'column' }]}>
            <Card style={styles.architectureStack}>
              {ARCHITECTURE_LAYERS.map(([title, text], index) => (
                <View key={title}>
                  <View style={styles.architectureRow}>
                    <View style={styles.architectureNumber}>
                      <Text style={styles.architectureNumberText}>{String(index + 1).padStart(2, '0')}</Text>
                    </View>
                    <View style={styles.architectureCopy}>
                      <Text style={styles.architectureTitle}>{title}</Text>
                      <Text style={styles.architectureText}>{text}</Text>
                    </View>
                  </View>
                  {index < ARCHITECTURE_LAYERS.length - 1 ? <View style={styles.architectureLine} /> : null}
                </View>
              ))}
            </Card>

            <View style={styles.architectureNotes}>
              <Card variant="info">
                <Text style={styles.noteTitle}>Каноническая цепочка</Text>
                <Text style={styles.noteText}>
                  Mobile → API / Auth / ACL → PostgreSQL → atomic transaction → audit + Domain Outbox → worker → provider → reconciliation.
                </Text>
              </Card>
              <Card variant="warning">
                <Text style={styles.noteTitle}>Граница доказанности</Text>
                <Text style={styles.noteText}>
                  Наличие адаптера или зелёного repository test не считается доказательством живой внешней операции. Для staging / production нужны отдельные retained evidence.
                </Text>
              </Card>
              <Card>
                <Text style={styles.noteTitle}>Технический источник</Text>
                <Text style={styles.noteText}>
                  Публичная страница следует текущему коду, living specification и production-readiness verdict, а не старым demo / MVP материалам.
                </Text>
                <View style={styles.inlineAction}>
                  <PrimaryButton title="Открыть спецификацию" variant="outline" onPress={openSpecification} />
                </View>
              </Card>
            </View>
          </View>
        </Section>

        <Section
          eyebrow="STATUS"
          title="Статус продукта — без маркетингового тумана"
          lead="Публичная презентация отделяет наличие кода от полной приёмки и внешней production verification."
        >
          <View style={[styles.grid, { gap: RenovaTheme.spacing.md }]}>
            <Card variant="success" style={{ ...styles.statusCard, width: cardWidth }}>
              <StatusPill label="ПОДТВЕРЖДЕНО В SOURCE" tone="success" />
              <Text style={styles.statusTitle}>Существенное ядро реализовано</Text>
              <Text style={styles.statusBody}>
                Текущий аудит подтверждает код для ключевых доменов, включая:
              </Text>
              <View style={styles.bulletList}>
                {IMPLEMENTED_CORE.map((item) => <Bullet key={item}>{item}</Bullet>)}
              </View>
            </Card>

            <Card variant="warning" style={{ ...styles.statusCard, width: cardWidth }}>
              <StatusPill label="ДОВОДИТСЯ" tone="warning" />
              <Text style={styles.statusTitle}>Production hardening продолжается</Text>
              <Text style={styles.statusBody}>
                Source-confirmed blockers относятся не к «красоте экрана», а к корректности отказов и сквозных сценариев:
              </Text>
              <View style={styles.bulletList}>
                {HARDENING_SCOPE.map((item) => <Bullet key={item}>{item}</Bullet>)}
              </View>
            </Card>

            <Card variant="info" style={{ ...styles.statusCard, width: cardWidth }}>
              <StatusPill label="EXTERNAL EVIDENCE" tone="info" />
              <Text style={styles.statusTitle}>Внешняя среда не объявляется проверенной</Text>
              <Text style={styles.statusBody}>
                Persistent staging / production, live providers, managed restore, capacity, store delivery и независимые внешние проверки требуют отдельного evidence на конкретном release candidate.
              </Text>
              <View style={styles.readinessBanner}>
                <Ionicons name="information-circle-outline" size={20} color={RenovaTheme.colors.infoText} />
                <Text style={styles.readinessText}>Текущий broad-production verdict: BLOCKED_FOR_BROAD_PRODUCTION.</Text>
              </View>
            </Card>
          </View>
        </Section>

        <Section
          eyebrow="QR / SHARE"
          title="Один адрес для встреч, презентаций и материалов"
          lead="QR генерируется локально. Если задан EXPO_PUBLIC_PLATFORM_URL, именно этот стабильный адрес кодируется независимо от текущего хостинга."
        >
          <Card style={styles.qrCard}>
            <View style={[styles.qrGrid, { flexDirection: wide ? 'row' : 'column' }]}>
              <View style={styles.qrCopy}>
                <Text style={styles.qrTitle}>Сканировать → открыть публичный обзор Renova</Text>
                <Text style={styles.cardText}>
                  В canonical QR намеренно не попадают UTM-параметры и hash. Это позволяет использовать один и тот же код на печатных и цифровых материалах.
                </Text>
                {canonicalUrl ? (
                  <View style={styles.urlBox}>
                    <Text style={styles.urlLabel}>CANONICAL URL</Text>
                    <Text selectable style={styles.urlValue}>{canonicalUrl}</Text>
                  </View>
                ) : (
                  <Text style={styles.mutedText}>
                    На server render URL появится после загрузки origin либо после задания EXPO_PUBLIC_PLATFORM_URL.
                  </Text>
                )}
                <View style={styles.qrActions}>
                  <PrimaryButton
                    title="Открыть продукт"
                    onPress={() => router.push('/onboarding/role')}
                  />
                  <PrimaryButton
                    title="Технический репозиторий"
                    variant="outline"
                    onPress={openRepository}
                  />
                </View>
              </View>
              <View style={styles.qrVisual}>
                {canonicalUrl ? <QrCodeImage value={canonicalUrl} size={wide ? 220 : 190} /> : null}
                <Text style={styles.qrCaption}>Renova / platform</Text>
              </View>
            </View>
          </Card>
        </Section>

        <View style={styles.footer}>
          <Text style={styles.footerBrand}>RENOVA</Text>
          <Text style={styles.footerText}>
            Публичный product brief. Функциональный статус отражает текущий репозиторий и living specification; страница не является заявлением о production readiness, подтверждённом ROI, размере рынка или финансовом прогнозе.
          </Text>
          <PrimaryButton title="GitHub / source" variant="ghost" onPress={openRepository} />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: RenovaTheme.colors.background,
  },
  pageContent: {
    paddingBottom: RenovaTheme.spacing.xxxl,
  },
  shell: {
    width: '100%',
    maxWidth: 1180,
    alignSelf: 'center',
    paddingHorizontal: RenovaTheme.spacing.lg,
  },
  topbar: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: RenovaTheme.colors.border,
  },
  brand: {
    color: RenovaTheme.colors.text,
    fontSize: RenovaTheme.fontSize.h2,
    fontWeight: RenovaTheme.fontWeight.extrabold,
    letterSpacing: 2,
  },
  brandSub: {
    marginTop: 2,
    color: RenovaTheme.colors.textSubtle,
    fontSize: RenovaTheme.fontSize.tiny,
    fontWeight: RenovaTheme.fontWeight.bold,
    letterSpacing: 1.4,
  },
  hero: {
    gap: RenovaTheme.spacing.xxl,
    paddingVertical: 48,
    alignItems: 'stretch',
  },
  heroCopy: {
    flex: 1.25,
    justifyContent: 'center',
  },
  eyebrow: {
    color: RenovaTheme.colors.accent,
    fontSize: RenovaTheme.fontSize.tiny,
    fontWeight: RenovaTheme.fontWeight.extrabold,
    letterSpacing: 1.2,
    marginBottom: RenovaTheme.spacing.sm,
  },
  heroTitle: {
    color: RenovaTheme.colors.text,
    fontSize: 46,
    lineHeight: 52,
    fontWeight: RenovaTheme.fontWeight.extrabold,
    maxWidth: 720,
  },
  heroLead: {
    marginTop: RenovaTheme.spacing.lg,
    color: RenovaTheme.colors.textMuted,
    fontSize: RenovaTheme.fontSize.h3,
    lineHeight: 25,
    maxWidth: 680,
  },
  ctaRow: {
    gap: RenovaTheme.spacing.sm,
    marginTop: RenovaTheme.spacing.xxl,
    alignItems: 'stretch',
  },
  ctaWide: {
    minWidth: 190,
  },
  ctaFull: {
    width: '100%',
  },
  heroFacts: {
    marginTop: RenovaTheme.spacing.xxl,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: RenovaTheme.spacing.sm,
  },
  heroFact: {
    minWidth: 150,
    flexGrow: 1,
    borderTopWidth: 1,
    borderTopColor: RenovaTheme.colors.border,
    paddingTop: RenovaTheme.spacing.sm,
  },
  heroFactLabel: {
    color: RenovaTheme.colors.textSubtle,
    fontSize: RenovaTheme.fontSize.tiny,
    fontWeight: RenovaTheme.fontWeight.bold,
    textTransform: 'uppercase',
  },
  heroFactValue: {
    color: RenovaTheme.colors.text,
    fontSize: RenovaTheme.fontSize.bodySmall,
    fontWeight: RenovaTheme.fontWeight.semibold,
    marginTop: 3,
  },
  heroVisualWrap: {
    flex: 0.75,
    justifyContent: 'center',
  },
  heroVisualCard: {
    padding: RenovaTheme.spacing.xl,
    marginBottom: 0,
  },
  visualHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: RenovaTheme.spacing.md,
    paddingBottom: RenovaTheme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: RenovaTheme.colors.border,
  },
  visualEyebrow: {
    color: RenovaTheme.colors.textSubtle,
    fontSize: RenovaTheme.fontSize.tiny,
    fontWeight: RenovaTheme.fontWeight.bold,
    letterSpacing: 1,
  },
  visualTitle: {
    marginTop: RenovaTheme.spacing.xs,
    color: RenovaTheme.colors.text,
    fontSize: RenovaTheme.fontSize.h3,
    fontWeight: RenovaTheme.fontWeight.bold,
  },
  controlRow: {
    minHeight: 52,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: RenovaTheme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: RenovaTheme.colors.borderLight,
  },
  controlLabel: {
    color: RenovaTheme.colors.textMuted,
    fontSize: RenovaTheme.fontSize.bodySmall,
    fontWeight: RenovaTheme.fontWeight.semibold,
    flexShrink: 1,
  },
  visualFooter: {
    flexDirection: 'row',
    gap: RenovaTheme.spacing.sm,
    marginTop: RenovaTheme.spacing.lg,
    alignItems: 'flex-start',
  },
  visualFooterText: {
    flex: 1,
    color: RenovaTheme.colors.textMuted,
    fontSize: RenovaTheme.fontSize.caption,
    lineHeight: 18,
  },
  section: {
    paddingVertical: 44,
    borderTopWidth: 1,
    borderTopColor: RenovaTheme.colors.border,
  },
  sectionTitle: {
    color: RenovaTheme.colors.text,
    fontSize: RenovaTheme.fontSize.display,
    lineHeight: 38,
    fontWeight: RenovaTheme.fontWeight.extrabold,
    maxWidth: 850,
  },
  sectionLead: {
    marginTop: RenovaTheme.spacing.md,
    color: RenovaTheme.colors.textMuted,
    fontSize: RenovaTheme.fontSize.body,
    lineHeight: 22,
    maxWidth: 850,
    marginBottom: RenovaTheme.spacing.xxl,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
  },
  infoCard: {
    minHeight: 160,
    marginBottom: 0,
  },
  featureCard: {
    minHeight: 190,
    marginBottom: 0,
  },
  roleCard: {
    minHeight: 154,
    marginBottom: 0,
  },
  flowCard: {
    minHeight: 210,
    marginBottom: 0,
  },
  flowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: RenovaTheme.spacing.lg,
  },
  flowIndex: {
    color: RenovaTheme.colors.textSubtle,
    fontSize: RenovaTheme.fontSize.h2,
    fontWeight: RenovaTheme.fontWeight.extrabold,
    letterSpacing: 1,
  },
  iconBubble: {
    width: 40,
    height: 40,
    borderRadius: RenovaTheme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: RenovaTheme.colors.infoBg,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.infoBorder,
  },
  cardTitle: {
    color: RenovaTheme.colors.text,
    fontSize: RenovaTheme.fontSize.h3,
    fontWeight: RenovaTheme.fontWeight.bold,
    marginTop: RenovaTheme.spacing.md,
    marginBottom: RenovaTheme.spacing.sm,
  },
  cardText: {
    color: RenovaTheme.colors.textMuted,
    fontSize: RenovaTheme.fontSize.body,
    lineHeight: 21,
  },
  roleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: RenovaTheme.spacing.md,
  },
  architectureGrid: {
    gap: RenovaTheme.spacing.lg,
    alignItems: 'stretch',
  },
  architectureStack: {
    flex: 1.35,
    marginBottom: 0,
    padding: RenovaTheme.spacing.xl,
  },
  architectureNotes: {
    flex: 0.65,
    gap: RenovaTheme.spacing.sm,
  },
  architectureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: RenovaTheme.spacing.md,
    minHeight: 58,
  },
  architectureNumber: {
    width: 38,
    height: 38,
    borderRadius: RenovaTheme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: RenovaTheme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  architectureNumberText: {
    color: RenovaTheme.colors.primaryMuted,
    fontSize: RenovaTheme.fontSize.caption,
    fontWeight: RenovaTheme.fontWeight.extrabold,
  },
  architectureCopy: {
    flex: 1,
  },
  architectureTitle: {
    color: RenovaTheme.colors.text,
    fontSize: RenovaTheme.fontSize.body,
    fontWeight: RenovaTheme.fontWeight.bold,
  },
  architectureText: {
    color: RenovaTheme.colors.textMuted,
    fontSize: RenovaTheme.fontSize.caption,
    lineHeight: 18,
    marginTop: 2,
  },
  architectureLine: {
    marginLeft: 18,
    width: 1,
    height: 10,
    backgroundColor: RenovaTheme.colors.border,
  },
  noteTitle: {
    color: RenovaTheme.colors.text,
    fontSize: RenovaTheme.fontSize.body,
    fontWeight: RenovaTheme.fontWeight.bold,
    marginBottom: RenovaTheme.spacing.sm,
  },
  noteText: {
    color: RenovaTheme.colors.textMuted,
    fontSize: RenovaTheme.fontSize.bodySmall,
    lineHeight: 20,
  },
  inlineAction: {
    marginTop: RenovaTheme.spacing.md,
  },
  statusCard: {
    minHeight: 350,
    marginBottom: 0,
  },
  statusTitle: {
    marginTop: RenovaTheme.spacing.lg,
    color: RenovaTheme.colors.text,
    fontSize: RenovaTheme.fontSize.h3,
    fontWeight: RenovaTheme.fontWeight.bold,
  },
  statusBody: {
    marginTop: RenovaTheme.spacing.sm,
    color: RenovaTheme.colors.textMuted,
    fontSize: RenovaTheme.fontSize.bodySmall,
    lineHeight: 20,
  },
  bulletList: {
    marginTop: RenovaTheme.spacing.md,
    gap: RenovaTheme.spacing.sm,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: RenovaTheme.spacing.sm,
  },
  bulletText: {
    flex: 1,
    color: RenovaTheme.colors.textMuted,
    fontSize: RenovaTheme.fontSize.bodySmall,
    lineHeight: 19,
  },
  readinessBanner: {
    marginTop: RenovaTheme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: RenovaTheme.spacing.sm,
    padding: RenovaTheme.spacing.md,
    borderRadius: RenovaTheme.radius.lg,
    backgroundColor: RenovaTheme.colors.infoBg,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.infoBorder,
  },
  readinessText: {
    flex: 1,
    color: RenovaTheme.colors.infoText,
    fontSize: RenovaTheme.fontSize.caption,
    lineHeight: 18,
    fontWeight: RenovaTheme.fontWeight.semibold,
  },
  qrCard: {
    padding: RenovaTheme.spacing.xl,
    marginBottom: 0,
  },
  qrGrid: {
    gap: RenovaTheme.spacing.xxl,
    alignItems: 'center',
  },
  qrCopy: {
    flex: 1,
  },
  qrVisual: {
    minWidth: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrTitle: {
    color: RenovaTheme.colors.text,
    fontSize: RenovaTheme.fontSize.h2,
    lineHeight: 25,
    fontWeight: RenovaTheme.fontWeight.extrabold,
    marginBottom: RenovaTheme.spacing.sm,
  },
  urlBox: {
    marginTop: RenovaTheme.spacing.lg,
    padding: RenovaTheme.spacing.md,
    borderRadius: RenovaTheme.radius.lg,
    backgroundColor: RenovaTheme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  urlLabel: {
    color: RenovaTheme.colors.textSubtle,
    fontSize: RenovaTheme.fontSize.tiny,
    fontWeight: RenovaTheme.fontWeight.bold,
    letterSpacing: 1,
  },
  urlValue: {
    marginTop: RenovaTheme.spacing.xs,
    color: RenovaTheme.colors.text,
    fontSize: RenovaTheme.fontSize.caption,
    lineHeight: 18,
  },
  mutedText: {
    marginTop: RenovaTheme.spacing.lg,
    color: RenovaTheme.colors.textSubtle,
    fontSize: RenovaTheme.fontSize.caption,
    lineHeight: 18,
  },
  qrActions: {
    marginTop: RenovaTheme.spacing.lg,
    gap: RenovaTheme.spacing.sm,
    maxWidth: 300,
  },
  qrCaption: {
    marginTop: -4,
    color: RenovaTheme.colors.textSubtle,
    fontSize: RenovaTheme.fontSize.caption,
    fontWeight: RenovaTheme.fontWeight.semibold,
  },
  footer: {
    paddingVertical: RenovaTheme.spacing.xxxl,
    borderTopWidth: 1,
    borderTopColor: RenovaTheme.colors.border,
    alignItems: 'flex-start',
  },
  footerBrand: {
    color: RenovaTheme.colors.text,
    fontSize: RenovaTheme.fontSize.h2,
    fontWeight: RenovaTheme.fontWeight.extrabold,
    letterSpacing: 2,
  },
  footerText: {
    maxWidth: 850,
    marginTop: RenovaTheme.spacing.sm,
    marginBottom: RenovaTheme.spacing.sm,
    color: RenovaTheme.colors.textMuted,
    fontSize: RenovaTheme.fontSize.caption,
    lineHeight: 18,
  },
});
