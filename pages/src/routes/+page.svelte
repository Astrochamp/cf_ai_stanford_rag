<script lang="ts">
  import { queryOracle } from "$lib/api";
  import type { Message } from "$lib/types";
  import { extractSourcesJson, parseTeX } from "$lib/parse";
  import { marked } from "marked";
  import { onMount } from "svelte";

  let query = $state("");
  let messages = $state<Message[]>([]);
  let isLoading = $state(false);
  let isDark = $state(false);
  let inputElement: HTMLTextAreaElement;
  let showUnusedSources = $state<Record<string, boolean>>({});

  // Configure marked for better output
  marked.setOptions({
    breaks: true,
    gfm: true,
    async: false,
  });

  const exampleQuestions = [
    "What is epistemology?",
    "Explain the mind-body problem",
    "What are the main arguments for free will?",
    "Describe the trolley problem",
  ];

  const DEBUG_QUESTION =
    "What are the differences between instant-based and interval-based models of time?";
  const DEBUG_RESPONSE = {
    query:
      "What are the differences between instant-based and interval-based models of time?",
    response:
      '## Summary\nInstant-based models take time instants as their primitive entities and represent temporal order by a precedence relation (logic-temporal/2.1/chunk-0). Interval-based models instead take periods as primitives, allow richer relations such as inclusion and overlap, and evaluate formulae relative to intervals (logic-temporal/2.2/chunk-0; logic-temporal/6/chunk-0).\n\n## Explanation\nThe two ontologies differ in their primitives: \'In instant-based models, the primitive temporal entities are points in time, i.e. time instants, and the basic relationship between them is temporal precedence.\' (logic-temporal/2.1/chunk-0). By contrast, \'In contrast to instant-based models of time, interval-based models rely on time intervals, i.e. periods rather than instants, as the primitive entities.\' (logic-temporal/2.2/chunk-0).\n\nBecause intervals are extended objects there are more possible relations between them (e.g. temporal precedence, inclusion, overlap), and interval models can explicitly include relations such as \\\\(\\\\prec,\\\\ \\\\sqsubseteq,\\\\) and \\\\(O\\\\) (logic-temporal/2.2/chunk-0). This makes interval-based frameworks in many ways technically richer: for example, they can address puzzles like Zeno’s flying arrow by treating motion as occupying an interval rather than a sequence of instants (logic-temporal/2.2/chunk-0).\n\nThe choice is not purely technical: \'The choice between instants and intervals as the primary objects of temporal ontology has been a highly debated philosophical theme since the times of Zeno and Aristotle.\' (logic-temporal/2.3/chunk-0). Technically the two are inter-definable — instants can be seen as degenerate intervals and intervals as pairs of instants — but that reducibility does not by itself settle whether sentences should be evaluated at points or over periods (logic-temporal/2.3/chunk-0).\n\nSemantically, instant-based temporal logic uses a Kripke-style account where \'the possible worlds are time instants, and the accessibility relation has a concrete interpretation in terms of temporal precedence.\' (logic-temporal/3.2/chunk-0). By contrast, in interval logics \'formulae are evaluated relative to time intervals rather than instants,\' and interval operators (e.g. those corresponding to Allen relations) are given Kripke-style semantics over relations between intervals (logic-temporal/6/chunk-0).\n\nThere are further consequences for formal expressiveness and application. Some global properties of a time order (e.g. continuity, Dedekind completeness, well-ordering) require stronger—often second-order—resources to express in instant-based settings (logic-temporal/2.1/chunk-1). Practically, the interval view is often invoked where aspectual or progressive linguistic distinctions matter: \'The relevant distinction here is one of aspect rather than of tense and seems to call for an interval-based or event-based setting.\' (logic-temporal/11.3/chunk-0).\n\n## Sources\n{\n  "used_evidence": [\n    {\n      "id": "logic-temporal/2.1/chunk-0",\n      "verbatim_quote": "In instant-based models, the primitive temporal entities are points in time, i.e. time instants, and the basic relationship between them is temporal precedence.",\n      "role_in_answer": "Defines instant-based primitives and basic relation"\n    },\n    {\n      "id": "logic-temporal/2.2/chunk-0",\n      "verbatim_quote": "In contrast to instant-based models of time, interval-based models rely on time intervals, i.e. periods rather than instants, as the primitive entities.",\n      "role_in_answer": "Defines interval-based primitives"\n    },\n    {\n      "id": "logic-temporal/2.2/chunk-0",\n      "verbatim_quote": "Interval-based models usually presuppose linear time. But they are richer than instant-based models as there are more possible relationships between time intervals than between time instants.",\n      "role_in_answer": "Explains richer relations available in interval models"\n    },\n    {\n      "id": "logic-temporal/2.3/chunk-0",\n      "verbatim_quote": "The choice between instants and intervals as the primary objects of temporal ontology has been a highly debated philosophical theme since the times of Zeno and Aristotle (Øhrstrøm and Hasle 1995).",\n      "role_in_answer": "States philosophical debate and reducibility caveat"\n    },\n    {\n      "id": "logic-temporal/3.2/chunk-0",\n      "verbatim_quote": "The standard semantics of TL is essentially a Kripke-style semantics, familiar from modal logic.",\n      "role_in_answer": "Introduces Kripke-style semantics for instant-based TL"\n    },\n    {\n      "id": "logic-temporal/6/chunk-0",\n      "verbatim_quote": "Crucially, in interval-based temporal logic, formulae are evaluated relative to time intervals rather than instants.",\n      "role_in_answer": "States how interval logics evaluate formulae"\n    },\n    {\n      "id": "logic-temporal/2.1/chunk-1",\n      "verbatim_quote": "Key examples of properties that cannot be expressed by first-order sentences, but require a second-order language with quantification over sets, are continuity, well-ordering, the finite interval property, and forward/backward induction.",\n      "role_in_answer": "Notes expressive limitations and need for stronger resources"\n    },\n    {\n      "id": "logic-temporal/11.3/chunk-0",\n      "verbatim_quote": "The relevant distinction here is one of aspect rather than of tense and seems to call for an interval-based or event-based setting.",\n      "role_in_answer": "Gives linguistic example motivating interval approach"\n    }\n  ]\n}',
    sources: [
      {
        id: "logic-temporal/2.2/chunk-0",
        doc_title: "Temporal Logic (Stanford Encyclopedia of Philosophy)",
        section_id: "logic-temporal/2.2",
        section_heading: "Interval-based models of time",
        chunk_index: 0,
        text: "In contrast to instant-based models of time, interval-based models rely on time intervals, i.e. periods rather than instants, as the primitive entities. They can, and have been, motivated by considerations concerning Zeno’s famous flying arrow paradox: If the flying arrow is always at an instant and if at each instant the arrow is at rest, then how is movement possible? By modelling the flight of the arrow as an event that occupies a temporal interval the paradox can arguably be avoided. Other examples that naturally invoke interval-based reasoning are: “Last night Alice cried a lot while writing the letter, and then she calmed down” and “Bill was drinking his tea when the postman came”.\n\nInterval-based models usually presuppose linear time. But they are richer than instant-based models as there are more possible relationships between time intervals than between time instants. An interval-based model of time can, for instance, include the relations temporal precedence \\(\\prec,\\) inclusion \\(\\sqsubseteq,\\) and overlap \\(O\\) over a given set of time intervals \\(T\\): formally, \\(\\mathcal{T}= \\left\\langle T,\\prec,\\sqsubseteq, O \\right\\rangle.\\) Some natural properties of such interval-based relations include:\n\n- reflexivity of \\(\\sqsubseteq:\\) \\(\\forall x(x\\sqsubseteq x);\\) - antisymmetry of \\(\\sqsubseteq:\\) \\(\\forall x\\forall y(x\\sqsubseteq y\\wedge y\\sqsubseteq x\\rightarrow x=y);\\) - atomicity of \\(\\sqsubseteq\\) (for discrete time): \\(\\forall x\\exists y(y\\sqsubseteq x\\wedge \\forall z(z\\sqsubseteq y\\rightarrow z=y));\\) - downward monotonicity of \\(\\prec\\) w.r.t. \\(\\sqsubseteq:\\) \\(\\forall x\\forall y\\forall z(x\\prec y\\wedge z\\sqsubseteq x\\rightarrow z\\prec y);\\) - symmetry of \\(O\\): \\(\\forall x\\forall y(xOy\\rightarrow yOx);\\) - overlapping intervals intersect in a subinterval:\n\n\\(\\forall x\\forall y (xOy \\rightarrow \\exists z( z \\sqsubseteq x \\land z \\sqsubseteq y \\land \\forall u ( u \\sqsubseteq x \\land u \\sqsubseteq y \\to u \\sqsubseteq z)));\\) - monotonicity of \\(\\sqsubseteq\\) w.r.t. \\(O\\): \\(\\forall x\\forall y \\forall z(x \\sqsubseteq y \\land xOz \\rightarrow z \\sqsubseteq y \\lor zOy).\\)\n\nIn an influential early work on interval-based temporal ontology and reasoning in AI, Allen (1983) considered the family of all binary relations that can arise between two intervals in a linear order, subsequently called Allen relations. These 13 relations, displayed in Table 1, are mutually exclusive and jointly exhaustive, i.e., exactly one of them holds between any given pair of strict intervals (excluding point-intervals). Moreover, they turn out to be definable in terms of only two of them, viz. in terms of ‘meets’ and ‘met-by’ (Allen 1983).\n\n[Figure: Table 1: Allen relations between time intervals and the corresponding Halpern-Shoham modal operators (see Section 6).]\n\nMore abstract questions can also be posed: assume, for example, that we are provided with a structure defined by a set of interval relations (of arbitrary arity) that are required to fulfill certain conditions. Can this structure be represented by a concrete interval-based model over linear time? Answers are provided by various representation theorems, see e.g. van Benthem (1983); Ladkin (1987); and Venema (1990).",
      },
      {
        id: "logic-temporal/2.3/chunk-0",
        doc_title: "Temporal Logic (Stanford Encyclopedia of Philosophy)",
        section_id: "logic-temporal/2.3",
        section_heading: "Instant-based vs. interval-based models of time",
        chunk_index: 0,
        text: "The choice between instants and intervals as the primary objects of temporal ontology has been a highly debated philosophical theme since the times of Zeno and Aristotle (Øhrstrøm and Hasle 1995). Technically, the two types of temporal ontologies are closely related, and they are reducible to each other: on the one hand, time intervals can be defined by pairs of time instants (beginning and end); on the other hand, a time instant can be construed as a degenerate interval, viz. as a point-interval whose beginning and end points coincide.\n\nStill, the technical reductions do not resolve the question whether sentences are to be evaluated with respect to instants or with respect to intervals, and one may argue that both instants and intervals are needed as mutually complementary. Two-sorted point-interval models were studied in e.g. Balbiani et al. (2011), and more complex models of time have been investigated as well, including models of time granularity (Euzenat and Montanari 2005), which allow for different resolution levels of temporal intervals (e.g. minutes, hours, days, years, etc.), metric and layered temporal models (Montanari 1996), etc.\n\nHere we focus mainly on instant-based logics and discuss interval-based logics in somewhat less detail. For further discussion on the ontological primacy of instants versus intervals in temporal logics, see Hamblin (1972); Kamp (1979); Humberstone (1979); Galton (1996); as well as van Benthem (1983; 1984), who provides a detailed comparative exploration of both approaches. A more philosophical and historical overview is provided in e.g. Øhrstrøm and Hasle (1995; 2006); Dyke and Bardon (2013); Meyer (2013); and Goranko (2023).",
      },
      {
        id: "logic-temporal/6/chunk-0",
        doc_title: "Temporal Logic (Stanford Encyclopedia of Philosophy)",
        section_id: "logic-temporal/6",
        section_heading: "Interval temporal logics",
        chunk_index: 0,
        text: "Instant-based and interval-based models of time introduce two different temporal ontologies, and even though they are technically reducible to each other, this does not solve the semantic issue: should propositions about time be interpreted as referring to time instants or to intervals?\n\nThere have been various explorations of interval-based temporal logics in the philosophical logic literature. Important early contributions include Hamblin (1972); Humberstone (1979); Röper (1980); and Burgess (1982b). The latter provides an axiomatization for an interval-based temporal logic with a precedence relation between intervals on the rationals and the reals. The interval-based approach to temporal reasoning has been very prominent in Artificial Intelligence. Some notable works here include Allen’s (1984) logic of planning, Kowalski and Sergot’s (1986) calculus of events, and Halpern and Shoham’s (1986) modal interval logic. It also features in some applications in computer science, such as real-time logics and hardware verification, notably Moszkowski’s (1983) interval logic and Zhou, Hoare, and Ravn’s duration calculus (see Hansen and Zhou 1997).\n\nHere we briefly present the propositional modal-logic style approach proposed by Halpern and Shoham (1986), hereafter called \\(\\mathsf{HS}.\\) The language of \\(\\mathsf{HS}\\) includes a family of unary interval operators of the form \\(\\langle X\\rangle,\\) one for each of Allen’s interval relations over linear time. The respective notations are listed in Table 1 (Section 2.2). Given a set of atomic propositions \\(PROP\\), formulae are recursively defined by the following grammar: \\[\\varphi := p \\in {PROP} \\mid \\neg \\varphi \\mid (\\varphi \\wedge \\varphi) \\mid \\langle X\\rangle\\varphi.\\]\n\nThe interval logic \\(\\mathsf{HS}\\) starts from instant-based models over linear time, and intervals are considered defined elements. Let \\(\\mathcal{T} = \\langle T,\\prec\\rangle\\) be a temporal frame with a precedence relation \\(\\prec\\) that induces a strict linear order on the set of time instants \\(T\\). An interval in \\(\\mathcal{T}\\) is defined as an ordered pair \\([a,b]\\) such that \\(a,b\\in T\\) and \\(a\\leq b.\\) The set of all intervals in \\(\\mathcal{T}\\) is denoted by \\(\\mathbb{I}(\\mathcal{T)}.\\) Note that the definition allows for ‘point intervals’ whose beginning and end points coincide, following the original proposal by Halpern and Shoham (1986). Sometimes only ‘strict’ intervals are considered.\n\nCrucially, in interval-based temporal logic, formulae are evaluated relative to time intervals rather than instants. An interval model is a triple \\(\\mathcal{M} = \\langle T,\\prec,V\\rangle\\) consisting of a strict linear temporal frame \\(\\mathcal{T} = \\langle T,\\prec\\rangle\\) and a valuation \\(V\\) that assigns to each atomic proposition \\(p\\in{PROP}\\) the set of time intervals \\(V(p) \\subseteq \\mathbb{I}(\\mathcal{T})\\) at which \\(p\\) is considered true. The truth of an arbitrary formula \\(\\varphi\\) at a given interval \\([a,b]\\) in an interval model \\(\\mathcal{M}\\) is defined by structural induction on formulae as follows:\n\n- \\(\\mathcal{M},[a,b] \\models p\\)   iff   \\([a,b]\\in V(p)\\), for \\(p \\in {PROP};\\) - \\(\\mathcal{M},[a,b] \\models \\neg\\varphi\\)   iff   \\(\\mathcal{M},[a,b] \\not\\models \\varphi;\\) - \\(\\mathcal{M},[a,b] \\models \\varphi \\wedge \\psi\\)   iff   \\(\\mathcal{M},[a,b] \\models \\varphi\\) and \\(\\mathcal{M},[a,b] \\models \\psi;\\) - \\(\\mathcal{M},[a,b] \\models \\langle X\\rangle\\varphi\\)   iff   \\(\\mathcal{M},[c,d] \\models \\varphi\\) for some interval \\([c,d]\\) such that \\([a,b]R_{X}[c,d]\\), where \\(R_X\\) is Allen’s interval relation corresponding to the modal operator \\(\\langle X\\rangle\\) (cf. Table 1).\n\nThat is, the new interval operators are given a Kripke-style semantics over the associated Allen relations. E.g., for the Allen relation “meets”, we have:\n\n\\[ \\mathcal{M},[t_{0},t_{1}] \\models \\langle A\\rangle \\varphi \\text{ iff } \\mathcal{M},[t_{1},t_{2}] \\models \\varphi \\text{ for some interval } [t_{1},t_{2}]. \\]",
      },
      {
        id: "logic-temporal/2.1/chunk-1",
        doc_title: "Temporal Logic (Stanford Encyclopedia of Philosophy)",
        section_id: "logic-temporal/2.1",
        section_heading: "Instant-based models of time",
        chunk_index: 1,
        text: "Key examples of properties that cannot be expressed by first-order sentences, but require a second-order language with quantification over sets, are continuity, well-ordering, the finite interval property, and forward/backward induction. Continuity demands that there be ‘no gaps’ in the temporal order. Not only must the temporal order be dense, it must also be Dedekind complete (i.e., every non-empty set of time instants that has an upper bound has a least upper bound). The ordering of the real numbers fulfills this condition, but the rational numbers do not. To see this, consider the set of all rational numbers whose square is less than 2 and note that \\(\\sqrt{2}\\) is not rational. An instant-based model of time is well-ordered if there are no infinite descending chains (i.e., every non-empty, linear set of time instants has a least element), and it has the finite interval property if between any two comparable time instants there are at most finitely many instants. The natural numbers are well-ordered and have the finite interval property, the integers are not well-ordered but have the finite interval property, and the rationals are neither well-ordered nor do they have the finite interval property. Lastly, a partial order is forward (resp. backward) inductive if there are ‘no transfinite forward (resp. backward) jumps’ (i.e., every infinite ascending (resp. descending) chain lacks a strict upper (resp. lower) bound). As we will see in Section 3.6, these second-order properties can be expressed in propositional temporal languages.",
      },
      {
        id: "logic-temporal/2.1/chunk-0",
        doc_title: "Temporal Logic (Stanford Encyclopedia of Philosophy)",
        section_id: "logic-temporal/2.1",
        section_heading: "Instant-based models of time",
        chunk_index: 0,
        text: "In instant-based models, the primitive temporal entities are points in time, i.e. time instants, and the basic relationship between them is temporal precedence. Accordingly, the flow of time is represented by a non-empty set of time instants \\(T\\) with a binary relation \\(\\prec\\) of precedence on it: \\(\\mathcal{T} = \\left\\langle T, \\prec \\right\\rangle.\\)\n\nThere are some basic properties which can naturally be imposed on instant-based flows of time. The temporal precedence relation \\(\\prec\\) is usually required to be a strict partial ordering, that is, an irreflexive, transitive, and hence asymmetric relation. In computer science, however, one often uses the reflexive closure \\(\\preceq \\) of the precedence relation, and then the asymmetry condition is replaced by antisymmetry. A list of key properties is provided below.\n\nOne fundamental distinction in the realm of instant-based models of time is the distinction between linear models, where the flow of time is depicted as a line, and backward-linear models, which allow for a tree-like representation, supporting the view that the past is fixed (and hence linear) while the future may be open (branching into multiple future possibilities). In either case, the temporal ordering may or may not contain minimal or maximal elements, corresponding to first or last instants in time, respectively.\n\nAnother important distinction is between discrete models of time, which are prevalent in computer science, and dense or continuous ones, which are more common in natural sciences and philosophy. In forward-discrete (resp. backward-discrete) models, each time instant that has a successor (resp. predecessor) has an immediate successor (resp. immediate predecessor). In dense models, by contrast, between any two subsequent time instants, there is another instant.\n\nMany, but not all, properties that may be imposed on an instant-based model of time \\(\\mathcal{T} = \\left\\langle T, \\prec \\right\\rangle\\) can be expressed by first-order sentences as follows (where \\(\\preceq\\) is an abbreviation of \\(x\\prec y \\lor x=y\\)):\n\n- reflexivity: \\(\\forall x (x\\prec x);\\) - irreflexivity: \\(\\forall x\\lnot (x\\prec x);\\) - transitivity: \\(\\forall x\\forall y\\forall z(x\\prec y\\wedge y\\prec z\\rightarrow x\\prec z);\\) - asymmetry: \\(\\forall x\\forall y \\lnot(x\\prec y\\wedge y\\prec x);\\) - antisymmetry: \\(\\forall x\\forall y(x\\prec y\\wedge y\\prec x\\rightarrow x=y);\\) - linearity (trichotomy): \\(\\forall x\\forall y(x=y\\vee x\\prec y\\vee y\\prec x);\\) - forward-linearity: \\(\\forall x\\forall y\\forall z(z\\prec x\\wedge z\\prec y\\rightarrow (x=y \\vee x \\prec y\\vee y\\prec x));\\) - backward-linearity: \\(\\forall x\\forall y\\forall z(x\\prec z\\wedge y\\prec z\\rightarrow (x=y \\vee x \\prec y\\vee y\\prec x));\\) - beginning: \\(\\exists x\\lnot\\exists y(y\\prec x);\\) - end: \\(\\exists x\\lnot\\exists y(x\\prec y);\\) - no beginning (backward-seriality): \\(\\forall x\\exists y(y\\prec x);\\) - no end (forward-seriality, unboundedness): \\(\\forall x\\exists y(x\\prec y);\\) - density: \\(\\forall x\\forall y(x\\prec y\\rightarrow \\exists z(x\\prec z\\wedge z\\prec y));\\) - forward-discreteness: \\(\\forall x\\forall y(x\\prec y\\rightarrow \\exists z(x\\prec z \\wedge z\\preceq y \\wedge \\lnot\\exists u(x\\prec u\\wedge u\\prec z)));\\) - backward-discreteness: \\(\\forall x\\forall y(y\\prec x\\rightarrow \\exists z(z\\prec x \\wedge y\\preceq z \\wedge \\lnot\\exists u(z\\prec u\\wedge u\\prec x))).\\)\n\nNote that, in linear models, the two discreteness conditions simplify to\n\n- \\(\\forall x\\forall y(x\\prec y\\rightarrow \\exists z(x\\prec z \\wedge \\forall u(x\\prec u \\rightarrow z\\preceq u)))\\) and - \\(\\forall x\\forall y(y\\prec x\\rightarrow \\exists z(z\\prec x \\wedge \\forall u(u\\prec x \\rightarrow u\\preceq z))),\\) respectively.",
      },
      {
        id: "logic-temporal/11.3/chunk-0",
        doc_title: "Temporal Logic (Stanford Encyclopedia of Philosophy)",
        section_id: "logic-temporal/11.3",
        section_heading: "Temporal logics in Linguistics",
        chunk_index: 0,
        text: "Tense is an important feature of natural languages. It is a linguistic device that allows one to specify the relative location of events in time, usually with respect to the speech time. In several languages, including English, tense becomes manifest in a system of different verbal tenses. English allows for a distinction between past, present, and future tense (‘will’ future), and traditionally, the respective perfect and progressive forms are referred to as tenses as well.\n\nAs laid out above, Prior’s invention of tense logic was motivated by the use of tense in natural language. An alternative early logical approach to tense was provided by Reichenbach (1947), who suggested an analysis of the English verbal tenses in terms of three points in time: speech time, event time, and reference time, where the reference time is a contextually salient point in time, which, intuitively, captures the perspective from which the event is viewed. Using the notion of reference time, Reichenbach was able to distinguish, for example, between the simple past (“I wrote a letter”) and the present perfect (“I have written a letter”), which are conflated in Prior’s account. With both the simple past and the present perfect, the event time precedes the speech time; but in the former case the reference time coincides with the event time, whereas in the latter case the reference time is simultaneous with the speech time.\n\nNeither Prior’s nor Reichenbach’s frameworks can account for the difference between, for instance, the simple past (“I wrote a letter”) and the past progressive (“I was writing a letter”). The relevant distinction here is one of aspect rather than of tense and seems to call for an interval-based or event-based setting. For accounts along these lines, see e.g. Dowty (1979); Parsons (1980); Galton (1984); and van Lambalgen and Hamm (2005).\n\nWhereas Reichenbach’s analysis makes reference to a contextually salient point in time, on Prior’s account tenses are construed as temporal operators, which are interpreted as quantifiers over instants in time. This raises the general question: are tenses in natural language to be treated as quantifiers, or do they refer to specific points in time? In an influential paper, Partee (1973) provided the following counterexample against a quantifier treatment of tenses: the sentence “I didn’t turn off the stove” means neither (1) there is an earlier time instant at which I do not turn off the stove, nor does it mean (2) there is no earlier instant at which I turn off the stove. The first requirement is too weak, the second too strong. Partee suggested an analogy between tenses and referential pronouns. According to this proposal, tenses refer to specific, contextually given points in time (e.g. 8 o’clock this morning), which are presupposed to stand in appropriate temporal relations to the speech time. Subsequently, accounts that restrict quantification to a contextually given time interval (e.g. this morning) have become popular. On these accounts, Partee’s example sentence has the intuitive meaning: there is no earlier time instant in the contextually salient time interval at which I turn off the stove. Formally, this is compatible with both quantifier and referential treatments of tense; for details see Kuhn and Portner (2002) and Ogihara (2011). Moreover, the idea of combining quantificational and referential elements can be dealt with in the hybrid variants of tense logic discussed in Section 7.1 (see Blackburn and Jørgensen 2016). The hybrid approach also allows for a Hans Kamp style treatment of temporal indexicals, such as “now” (Kamp 1971), as was noticed by Prior as early as 1968 (Prior 1968).\n\nOther pertinent issues in linguistics relating to time concern the meaning of temporal adverbs and connectives, the interaction of tense and quantification, the interpretation of embedded tenses and sequence of tense, as well as the interrelation of tense and modality. For an overview and further discussion on the application of temporal logics in linguistics, see e.g. Steedman (1997); Kuhn and Portner (2002); Mani et al. (2005); ter Meulen (2005); Moss and Tiede (2007); Ogihara (2007; 2011); Dyke (2013); and the entry on tense and aspect.",
      },
      {
        id: "logic-temporal/11.2/chunk-0",
        doc_title: "Temporal Logic (Stanford Encyclopedia of Philosophy)",
        section_id: "logic-temporal/11.2",
        section_heading: "Temporal logics in Artificial Intelligence",
        chunk_index: 0,
        text: "Artificial Intelligence (AI) is one of the major areas of application of temporal logics. Important topics in AI which have been explored with their help include: temporal ontologies, spatial-temporal reasoning, temporal databases and constraint solving, executable temporal logics, temporal planning, temporal reasoning in agent-based systems, and natural language processing. Comprehensive overviews of a wide variety of applications may be found in e.g. Vila (1994); Galton (1995); Fisher et al. (2005); and Fisher (2008). See also the related discussion on reasoning about action and change in Section 4 of the entry on logic and artificial intelligence.\n\nThe idea of relating temporal reasoning and AI was first discussed in the late 1960s and 70s, and it flourished in the 1980s and 90s; for overviews of historical developments, see Galton (1987); Vila (1994); Øhrstrøm and Hasle (1995); and Pani and Bhattacharjee (2001). The combination of temporal logic and AI was suggested in the early philosophical discussion on AI by McCarthy and Hayes (1969), the theory of processes and events in Rescher and Urquhart (1971, Chapter XIV), and the period-based theories of Hamblin (1972). Seminal work from the 1980s and 90s include: McDermott’s (1982) temporal logic for reasoning about processes and plans, Allen’s (1984) general theory of action and time, the event calculus of Kowalski and Sergot (1986), the reified temporal logic by Shoham (1987), the logic of time representation by Ladkin (1987), the work on temporal database management by Dean and McDermott (1987), the introduction of interval-based temporal logics by Halpern and Shoham (1991) and by Allen and Ferguson (1994) (with representation of actions and events), the situation calculus of Pinto and Reiter (1995), and Lamport’s (1994) action theory.\n\nAlthough it is much concerned with applications, the debate in the AI literature raises interesting philosophical issues, too. Philosophical questions naturally arise with respect to the ontological foundations of the temporal models: the choice between discrete and continuous, instant-based and interval-based temporal models is one example. Both instant-based and interval-based approaches have been developed and compared, see e.g. van Benthem (1983); Allen (1983); Allen and Hayes (1989); Allen and Ferguson (1994); Galton (1090; 1995); Vila (2005); etc.\n\nFurthermore, the AI literature distinguishes between different kinds of temporal phenomena, such as fluents, events, actions, and states. While fluents concern states of the world that may change over time (e.g. whether the light is on or off), events and actions represent what happens in the world and causes changes between states (e.g. the turning on of the light, the room becoming light). Theories of temporal incidence explore the structural properties of these phenomena, such as whether they are homogenous over an extended period of time (e.g. if the light is on from 2 o'clock to 4 o'clock, can we infer that it was on at 3 o'clock?). See e.g. Galton (2005); Vila (2005); etc.\n\nOnce we have incorporated such temporal phenomena in our models, we need to specify a logical language that allows us to express when they happen or occur. In the AI literature, different methods of temporal qualification can be found. For an overview, see Reichgelt and Vila (2005). Traditionally, temporalized variations of first-order logic rather than Prior style temporal logics have been used. Perhaps the simplest first-order approach is the so-called method of temporal arguments (McCarthy and Hayes 1969; Shoham 1987; Vila 1994). Here the temporal dimension is captured by augmenting propositions and predicates with ‘time stamp’ arguments; for example “Publish(A. Prior, Time and Modality, 1957)”. An alternative, yet closely related approach, is that of reified temporal logics (McDermott 1982; Allen 1984; Shoham 1987; see Ma and Knight 2001 for a survey). This approach makes use of reifying meta-predicates, such as ‘TRUE’ and ‘FALSE’, but also ‘HOLDS’, ‘OCCURS’, ‘BEFORE’, ‘AFTER’, and interval relations such as ‘MEETS’, ‘OVERLAPS’, etc., which are applied to propositions of some standard logical language (e.g. classical first-order logic); for example “OCCUR(Born(A. Prior), 1914)”. Still, the modal-logic style approach has had a recent resurgence, e.g. in the context of agent-based temporal reasoning (cf. Fisher and Wooldridge 2005).",
      },
      {
        id: "logic-temporal/2/chunk-0",
        doc_title: "Temporal Logic (Stanford Encyclopedia of Philosophy)",
        section_id: "logic-temporal/2",
        section_heading: "Formal models of time",
        chunk_index: 0,
        text: "Philosophers have extensively discussed the ontological nature and properties of time. Several aspects of the debate are reflected in the rich variety of formal models of time as they have been explored in temporal logics. For example, is time instant-based or interval-based? Is it discrete, dense, or continuous? Does time have a beginning or an end? Is it linear, branching, or circular? Before we turn to the formal languages of temporal logics and their semantics, we briefly introduce below the two most basic types of formal models of time together with some of their pertinent properties: instant-based and interval-based models.",
      },
      {
        id: "logic-temporal/7.2/chunk-0",
        doc_title: "Temporal Logic (Stanford Encyclopedia of Philosophy)",
        section_id: "logic-temporal/7.2",
        section_heading: "Metric and real-time temporal logics",
        chunk_index: 0,
        text: "Metric temporal logics go back to Prior, too (see Prior 1967, Chapter VI). He used the notation \\(Pn\\varphi\\) for “It was the case the interval \\(n\\) ago that \\(\\varphi\\)” (i.e. \\(\\varphi\\) was the case \\(n\\) time units ago) and \\(Fn\\varphi\\) for “It will be the case the interval \\(n\\) hence that \\(\\varphi\\)” (i.e \\(\\varphi\\) will be the case \\(n\\) time units hence). These operators presuppose that time has a certain metric structure and can be carved up into temporal units, which may be associated with clock times (e.g. hours, days, years, etc.). If the relevant units are days, for example, the operator \\(F 1\\) reads ‘the following day’ (or just ‘tomorrow’).\n\nPrior noted that \\(P n\\varphi\\) can be defined as \\(F(-n)\\varphi.\\) The case \\(n=0\\) accordingly amounts to the present tense. The metric operators validate combination principles such as:\n\n\\[FnFm\\varphi \\rightarrow F(n+m)\\varphi.\\]\n\nThe interrelation of the metric and non-metric versions of the temporal operators is captured by the following equivalences:\n\n\\[\\begin{matrix} P\\varphi \\equiv \\exists {n}({n} \\lt 0 \\land Fn\\varphi) & F\\varphi \\equiv \\exists n(n \\gt 0 \\land Fn\\varphi) \\\\ H\\varphi \\equiv \\forall {n}({n} \\lt 0 \\rightarrow Fn\\varphi) & G\\varphi \\equiv \\forall n(n \\gt 0 \\rightarrow Fn\\varphi). \\end{matrix}\\]\n\nInstant-based temporal logics for metric time are studied in e.g. Rescher and Urquhart (1971, Chapter X); Montanari (1996); and Montanari and Policriti (1996). For metric interval logics, see Bresolin et al. (2013).\n\nVarious metric extensions of temporal logics over the structure of the real numbers have been proposed, giving rise to so-called real-time logics. These logics introduce additional operators, such as the following, which enable different formalizations of the sentence “whenever \\(p\\) holds in the future, \\(q\\) will hold within three time units later”:\n\n- time-bounded operators, e.g.: \\(G(p \\to F_{_{\\leq 3}} q);\\) - freeze quantifiers (similar to hybrid logic reference pointers), e.g.: \\(Gx. (p \\to Fy. (q \\land y\\leq x+3));\\) - quantifiers over time variables, e.g.: \\(\\forall x G(p \\land t=x \\to F(q \\land t\\leq x+3)).\\)\n\nSuch real-time extensions are usually very expressive and often lead to logics with undecidable decision problems. A way to regain decidability is to relax “punctuality” requirements involving precise time durations by requirements involving time intervals. For details, see e.g. Koymans (1990); Alur and Henzinger (1992; 1993; 1994) as well as Reynolds (2010; 2014) on the real-time linear temporal logic RTL, and the survey Konur (2013).",
      },
      {
        id: "logic-temporal/3.2/chunk-0",
        doc_title: "Temporal Logic (Stanford Encyclopedia of Philosophy)",
        section_id: "logic-temporal/3.2",
        section_heading: "Semantics of TL",
        chunk_index: 0,
        text: "The standard semantics of TL is essentially a Kripke-style semantics, familiar from modal logic. In modal logic, sentences are evaluated over so-called Kripke frames consisting of a non-empty set of possible worlds and an accessibility relation between them. In temporal logic, the possible worlds are time instants, and the accessibility relation has a concrete interpretation in terms of temporal precedence. In other words, sentences are evaluated over instant-based models of time \\(\\mathcal{T}=\\left\\langle T, \\prec \\right\\rangle\\), hereafter called temporal frames. Note that so far no conditions, like transitivity, irreflexivity, etc., are imposed on the precedence relation \\(\\prec\\).\n\nGiven a set of atomic propositions \\(PROP\\), a temporal model for TL is a triple \\(\\mathcal{M}= \\left\\langle T, \\prec, V \\right\\rangle\\) where \\(\\mathcal{T} =\\left\\langle T, \\prec \\right\\rangle\\) is a temporal frame and \\(V: PROP \\rightarrow \\mathcal{P}(T)\\) is a valuation function that assigns to each atomic proposition \\(p\\in{PROP}\\) the set of time instants \\(V(p) \\subseteq T\\) at which \\(p\\) is considered true. (Equivalently, the valuation can be given by a function \\(I: T\\times{PROP}\\to \\{\\mathit{true},\\mathit{false}\\},\\) which assigns a truth value to each atomic proposition at each time instant in the temporal frame, or by a labeling or state description \\(L: T \\to \\mathcal{P}({PROP})\\), which assigns to each time instant the set of atomic propositions that are considered true at that instant.)\n\nThe truth of an arbitrary formula \\(\\varphi\\) of TL at a given time instant \\(t\\) in a temporal model \\(\\mathcal{M}\\) (denoted \\(\\mathcal{M},t \\models\\varphi\\)) is then defined inductively as follows:\n\n- \\(\\mathcal{M},t \\models p\\)   iff   \\(t \\in V(p)\\), for \\(p \\in {PROP}\\); - \\(\\mathcal{M},t \\models \\neg\\varphi\\)   iff   \\(\\mathcal{M},t \\not\\models\\varphi\\) (i.e., it is not the case that \\(\\mathcal{M},t \\models \\varphi\\)); - \\(\\mathcal{M},t \\models \\varphi \\wedge \\psi\\)   iff   \\(\\mathcal{M},t \\models\\varphi\\) and \\(\\mathcal{M},t \\models\\psi\\); - \\(\\mathcal{M},t \\models P\\varphi\\)   iff   \\(\\mathcal{M},t'\\models \\varphi\\) for some time instant \\(t'\\) such that \\(t'\\prec t{;}\\) - \\(\\mathcal{M},t \\models F\\varphi\\)   iff   \\(\\mathcal{M},t'\\models \\varphi\\) for some time instant \\(t'\\) such that \\(t\\prec t'.\\)\n\nThat is, a formula of the form \\(P\\varphi\\) is true at an instant \\(t\\) iff \\(\\varphi\\) is true at some earlier instant \\(t',\\) while \\(F\\varphi\\) is true at \\(t\\) iff \\(\\varphi\\) is true at some later instant \\(t'.\\) Accordingly, for the duals \\(H\\) and \\(G\\), we have that \\(H\\varphi\\) is true at \\(t\\) iff \\(\\varphi\\) is true at all earlier instants \\(t',\\) and \\(G\\varphi\\) is true at \\(t\\) iff \\(\\varphi\\) is true at all later instants \\(t'.\\)\n\n- \\(\\mathcal{M},t \\models H\\varphi\\)   iff   \\(\\mathcal{M},t'\\models \\varphi\\) for all time instants \\(t'\\) such that \\(t'\\prec t\\); - \\(\\mathcal{M},t \\models G\\varphi\\)   iff   \\(\\mathcal{M},t'\\models \\varphi\\) for all time instants \\(t'\\) such that \\(t\\prec t'\\).\n\nNote that, from the point of view of modal logic, there are two different accessibility relations involved here: an ‘earlier-relation’ in the case of the past operators and a ‘later-relation’ in the case of the future operators. In temporal logic, these two relations are covered by a single precedence relation; after all, ‘earlier’ and ‘later’ are just converses of each other (i.e., \\(t\\) is earlier than \\(t'\\) iff \\(t'\\) is later than \\(t\\)).\n\nA formula \\(\\varphi\\) of TL is valid in a temporal model \\(\\mathcal{M}\\) (denoted \\(\\mathcal{M} \\models \\varphi\\)) iff it is true at every time instant in that model. Moreover, we say that \\(\\varphi\\) is valid in a temporal frame \\(\\mathcal{T}\\) (denoted \\(\\mathcal{T} \\models \\varphi\\)) iff it is valid in every model on that frame. Accordingly, a formula \\(\\varphi\\) is valid (denoted \\(\\models \\varphi\\)) iff it is valid in all temporal frames, i.e. true at all time instants in all temporal models. A formula \\(\\varphi\\) is satisfiable iff its negation is not valid, i.e. if \\(\\varphi\\) is true at some time instant in some temporal model.",
      },
      {
        id: "logic-temporal/4/chunk-0",
        doc_title: "Temporal Logic (Stanford Encyclopedia of Philosophy)",
        section_id: "logic-temporal/4",
        section_heading: "Extensions of TL over linear time",
        chunk_index: 0,
        text: "A natural class of instant-based models of time is the class of linear models, and soon after Prior’s invention of Tense Logic several extensions of TL over linear time have been proposed. In this section, we discuss two such extensions: the Next Time operator and the operators Since and Until. We then introduce the linear time temporal logic LTL, which is based on those operators and has important applications in computer science.",
      },
      {
        id: "logic-temporal/4.1/chunk-0",
        doc_title: "Temporal Logic (Stanford Encyclopedia of Philosophy)",
        section_id: "logic-temporal/4.1",
        section_heading: "Adding the Next Time operator",
        chunk_index: 0,
        text: "In forward-discrete, linear temporal models \\(\\mathcal{M}= \\left\\langle T,\\prec, V \\right\\rangle\\) without end point, where every instant \\(t\\) has a unique immediate successor \\(s(t),\\) it is natural to add a new temporal operator \\(X\\) (“NeXt Time” or “Tomorrow”) with the following semantics:[2]\n\n\\[ \\mathcal{M},t \\models X\\varphi \\text{ iff } \\mathcal{M},s(t) \\models \\varphi. \\]\n\nThat is, \\(X\\varphi\\) is true at a time instant \\(t\\) iff \\(\\varphi\\) is true at the immediate successor \\(s(t)\\) of \\(t\\). The Next Time operator was already mentioned by Prior (1967, Chapter IV.3), but its importance was first fully appreciated in the context of LTL.\n\nThe operator \\(X\\) satisfies the K-axiom\n\n- (K\\(_{X}\\)) \\(X(\\varphi \\to \\psi) \\to (X\\varphi \\to X\\psi);\\)\n\nand the functionality axiom\n\n- (FUNC) \\(X\\lnot \\varphi \\leftrightarrow \\lnot X\\varphi.\\)\n\nIt also enables a recursive fixed point definition of \\(G\\) and, on the ordering of the natural numbers, the operators \\(X\\) and \\(G\\) satisfy an induction principle. Assuming the reflexive closure of the precedence relation \\(\\prec\\), as is common in computer science, these properties can be expressed as follows:\n\n- (FP\\(_G\\)) \\(G\\varphi \\leftrightarrow (\\varphi \\wedge XG\\varphi);\\) - (IND) \\(\\varphi \\wedge G(\\varphi \\rightarrow X\\varphi )\\rightarrow G\\varphi.\\)\n\nIn the language with \\(G,H,\\) and \\(X\\), these principles can be used to provide sound and complete axiomatizations of the temporal logic of forward-discrete, linear orderings without end points and the natural numbers with successor function, respectively:\n\n\\(\\mathbf{L}_{t}(X) = \\mathbf{L}_{t}\\) + (K\\(_{X}\\)) + (FUNC) + (FP\\(_{G}\\)): all forward-discrete, linear orderings without end points.\n\n\\(\\mathbf{N}_{t}(X) = \\mathbf{N}_{t}\\) + (K\\(_{X}\\)) + (FUNC) + (FP\\(_{G}) \\) + (IND): \\(\\left\\langle \\mathbf{N},s,\\leq \\right\\rangle,\\) where \\(s(n) = n+1.\\)\n\nA past analogue of \\(X\\), usually denoted \\(Y\\) (“Yesterday”), can be defined and axiomatized likewise. For details, see Goldblatt (1992) and Andréka et al. (1995).",
      },
    ],
    count: 12,
  };

  // Initialize theme based on localStorage or system preference
  onMount(() => {
    const stored = localStorage.getItem("theme");
    if (stored) {
      isDark = stored === "dark";
    } else {
      isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    }

    // Handle citation link clicks
    const handleCitationClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.classList.contains("citation") &&
        !target.classList.contains("unsupported")
      ) {
        e.preventDefault();
        const sourceId = target.getAttribute("data-source-id");
        if (sourceId) {
          scrollToSource(sourceId);
        }
      }
    };

    document.addEventListener("click", handleCitationClick);
    return () => {
      document.removeEventListener("click", handleCitationClick);
    };
  });

  function toggleTheme() {
    isDark = !isDark;
    localStorage.setItem("theme", isDark ? "dark" : "light");
  }

  async function handleSubmit() {
    if (!query.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: query.trim(),
      timestamp: new Date(),
    };

    messages = [...messages, userMessage];
    const currentQuery = query;
    query = "";
    isLoading = true;

    try {
      // TEMPORARY: Using debug constants instead of API call for UI development
      // const response = await queryOracle(currentQuery);

      // Simulate a small delay to mimic API call
      await new Promise((resolve) => setTimeout(resolve, 500));

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: DEBUG_RESPONSE.response,
        sources: DEBUG_RESPONSE.sources,
        usedEvidence: extractSourcesJson(DEBUG_RESPONSE.response) || [],
        timestamp: new Date(),
      };

      messages = [...messages, assistantMessage];
    } catch (error) {
      console.error("Error querying oracle:", error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          "I apologize, but I encountered an error processing your query. Please try again.",
        timestamp: new Date(),
      };
      messages = [...messages, errorMessage];
    } finally {
      isLoading = false;
      setTimeout(() => inputElement?.focus(), 0);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function selectExample(example: string) {
    query = example;
    inputElement?.focus();
  }

  function clearConversation() {
    messages = [];
    query = "";
  }

  function toggleUnusedSources(messageId: string) {
    showUnusedSources[messageId] = !showUnusedSources[messageId];
  }

  // Helper function to categorize sources into used and unused
  function categorizeSources(message: Message) {
    const allSources = message.sources || [];
    const usedEvidence = message.usedEvidence || [];
    const usedSourceIds = new Set(usedEvidence.map((e) => e.id));

    const usedSources = allSources.filter((s) => usedSourceIds.has(s.id));
    const unusedSources = allSources.filter((s) => !usedSourceIds.has(s.id));

    // Create a map for quick lookup of used evidence details
    const evidenceMap = new Map(usedEvidence.map((e) => [e.id, e]));

    // Extract citation numbers from the message content to order sources
    const citationOrder = extractCitationOrder(message.content);

    // Sort used sources by their citation number
    const sortedUsedSources = usedSources.sort((a, b) => {
      const citationA = citationOrder.get(a.id) ?? Infinity;
      const citationB = citationOrder.get(b.id) ?? Infinity;
      return citationA - citationB;
    });

    return {
      usedSources: sortedUsedSources,
      unusedSources,
      evidenceMap,
      citationOrder,
    };
  }

  // Helper function to extract citation ordering from text
  function extractCitationOrder(text: string): Map<string, number> {
    const sourceIdToCitationNumber = new Map<string, number>();
    let nextCitationNumber = 1;

    // Match citations in the same format as parseCitations
    const citationRegex =
      /\((UNSUPPORTED BY PROVIDED SOURCES|([a-zA-Z\d\_\-]+\/\d(\.*\d?)*\/chunk-\d+)(;\s*)*([a-zA-Z\d\_\-]+\/\d(\.*\d?)*\/chunk-\d+)*)\)/g;

    let match;
    while ((match = citationRegex.exec(text)) !== null) {
      const content = match[1];

      // Skip unsupported claims
      if (content.trim() === "UNSUPPORTED BY PROVIDED SOURCES") {
        continue;
      }

      // Split by semicolon for multiple citations
      const sourceIds = content.split(";").map((id: string) => id.trim());

      // Validate source IDs
      const validSourceIdPattern = /^[a-zA-Z\d\_\-]+\/\d(\.*\d?)*\/chunk-\d+$/;
      const allValid = sourceIds.every((id: string) =>
        validSourceIdPattern.test(id),
      );

      if (!allValid) {
        continue;
      }

      // Assign citation numbers in order of appearance
      for (const sourceId of sourceIds) {
        if (!sourceIdToCitationNumber.has(sourceId)) {
          sourceIdToCitationNumber.set(sourceId, nextCitationNumber++);
        }
      }
    }

    return sourceIdToCitationNumber;
  }

  // Helper function to parse and convert citations to clickable links
  // Also handles TeX math expressions
  function parseCitations(text: string | Promise<string>): string {
    // Ensure text is a string (marked can return Promise in some configs)
    const textStr = typeof text === "string" ? text : "";

    // Create a map to track unique citation numbers for each source ID
    const sourceIdToCitationNumber = new Map<string, number>();
    let nextCitationNumber = 1;

    // More specific regex that matches:
    // 1. (UNSUPPORTED BY PROVIDED SOURCES) - exact match
    // 2. Source IDs in format: (word/1.2/chunk-N) or (word/2.3.4/chunk-N; word/5/chunk-N)
    //    Source IDs contain alphanumeric, hyphens, underscores, forward slashes
    //    Multiple sources are separated by semicolons
    const citationRegex =
      /\((UNSUPPORTED BY PROVIDED SOURCES|([a-zA-Z\d\_\-]+\/\d(\.*\d?)*\/chunk-\d+)(;\s*)*([a-zA-Z\d\_\-]+\/\d(\.*\d?)*\/chunk-\d+)*)\)/g;

    return textStr.replace(citationRegex, (match, content) => {
      // Check if it's the unsupported claim marker
      if (content.trim() === "UNSUPPORTED BY PROVIDED SOURCES") {
        return `<span class="citation unsupported" title="This claim is not supported by the provided sources">[citation needed]</span>`;
      }

      // Split by semicolon for multiple citations
      const sourceIds = content.split(";").map((id: string) => id.trim());

      // Validate that all source IDs match the expected format (e.g., "word/1.2.3/chunk-N")
      const validSourceIdPattern = /^[a-zA-Z\d\_\-]+\/\d(\.*\d?)*\/chunk-\d+$/;
      const allValid = sourceIds.every((id: string) =>
        validSourceIdPattern.test(id),
      );

      // If not all IDs are valid, don't treat this as a citation
      if (!allValid) {
        return match; // Return the original text unchanged
      }

      // Create clickable citation links with unique numbers
      const citationLinks = sourceIds
        .map((sourceId: string) => {
          // Get or assign a unique citation number for this source
          if (!sourceIdToCitationNumber.has(sourceId)) {
            sourceIdToCitationNumber.set(sourceId, nextCitationNumber++);
          }
          const citationNumber = sourceIdToCitationNumber.get(sourceId)!;

          const safeId = sourceId.replace(/[^a-zA-Z0-9-]/g, "_");
          return `<a href="#source-${safeId}" class="citation" data-source-id="${sourceId}" title="Jump to source: ${sourceId}">[${citationNumber}]</a>`;
        })
        .join("");

      return citationLinks;
    });
  }

  // Helper function to render content with TeX, markdown, and citations
  function renderContent(content: string): string {
    // Step 1: Parse TeX expressions first (before markdown)
    const withTeX = parseTeX(content);
    // Step 2: Parse markdown
    const withMarkdown = marked(withTeX);
    // Step 3: Parse citations
    const withCitations = parseCitations(withMarkdown);
    return withCitations;
  }

  // Function to scroll to a source element
  function scrollToSource(sourceId: string) {
    const safeId = sourceId.replace(/[^a-zA-Z0-9-]/g, "_");
    const element = document.getElementById(`source-${safeId}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      // Add a highlight effect
      element.classList.add("highlight-source");
      setTimeout(() => {
        element.classList.remove("highlight-source");
      }, 2000);
    }
  }

  // Helper function to extract article ID from source ID
  function getArticleId(sourceId: string): string | null {
    // Format: article-id/section/chunk-N
    const parts = sourceId.split("/");
    return parts.length > 0 ? parts[0] : null;
  }

  // Helper function to get SEP URL for a source
  function getSEPUrl(sourceId: string): string | null {
    const articleId = getArticleId(sourceId);
    return articleId
      ? `https://plato.stanford.edu/entries/${articleId}/`
      : null;
  }
</script>

<svelte:head>
  <title>SEP Oracle - Stanford Encyclopedia of Philosophy RAG</title>
  <meta
    name="description"
    content="An unofficial RAG system for querying the Stanford Encyclopedia of Philosophy"
  />
</svelte:head>

<div
  class="min-h-screen transition-colors duration-300 {isDark
    ? 'bg-linear-to-br from-slate-900 via-stone-900 to-slate-900'
    : 'bg-linear-to-br from-slate-50 via-stone-50 to-amber-50/30'}"
>
  <!-- Header -->
  <header
    class="border-b sticky top-0 z-10 shadow-sm transition-colors duration-300 {isDark
      ? 'border-stone-700 bg-stone-900/80 backdrop-blur-sm'
      : 'border-stone-200 bg-white/80 backdrop-blur-sm'}"
  >
    <div class="max-w-5xl mx-auto px-6 py-6">
      <div class="flex items-center justify-between">
        <div>
          <h1
            class="text-3xl font-bold font-serif tracking-tight {isDark
              ? 'text-stone-100'
              : 'text-stone-900'}"
          >
            SEP Oracle
          </h1>
          <p
            class="text-sm mt-1 font-light {isDark
              ? 'text-stone-400'
              : 'text-stone-600'}"
          >
            Stanford Encyclopedia of Philosophy · Retrieval-Augmented Generation
          </p>
        </div>
        <div class="flex items-center gap-3">
          <!-- Theme Toggle -->
          <button
            onclick={toggleTheme}
            class="p-2 rounded-lg transition-colors {isDark
              ? 'hover:bg-stone-800 text-amber-400'
              : 'hover:bg-stone-100 text-stone-600'}"
            aria-label="Toggle theme"
          >
            {#if isDark}
              <!-- Sun icon -->
              <svg
                class="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
            {:else}
              <!-- Moon icon -->
              <svg
                class="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
              </svg>
            {/if}
          </button>
          {#if messages.length > 0}
            <button
              onclick={clearConversation}
              class="text-sm transition-colors px-4 py-2 rounded-lg {isDark
                ? 'text-stone-400 hover:text-stone-100 hover:bg-stone-800'
                : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'}"
            >
              Clear
            </button>
          {/if}
        </div>
      </div>
    </div>
  </header>

  <main class="max-w-5xl mx-auto px-6 py-12">
    {#if messages.length === 0}
      <!-- Welcome Screen -->
      <div class="text-center mb-16 mt-8">
        <div
          class="inline-block p-4 rounded-full mb-6 {isDark
            ? 'bg-amber-900/30'
            : 'bg-amber-100/50'}"
        >
          <svg
            class="w-16 h-16 {isDark ? 'text-amber-400' : 'text-amber-800'}"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
        </div>
        <h2
          class="text-4xl font-serif font-bold mb-4 {isDark
            ? 'text-stone-100'
            : 'text-stone-900'}"
        >
          Welcome to SEP Oracle
        </h2>
        <p
          class="text-lg max-w-2xl mx-auto leading-relaxed mb-8 {isDark
            ? 'text-stone-300'
            : 'text-stone-700'}"
        >
          Ask questions about philosophy and receive answers grounded in the
          <span class="font-semibold">Stanford Encyclopedia of Philosophy</span
          >. This unofficial tool uses retrieval-augmented generation to provide
          scholarly insights.
        </p>
      </div>

      <!-- Example Questions -->
      <div class="mb-12">
        <h3
          class="text-sm font-semibold uppercase tracking-wider mb-4 {isDark
            ? 'text-stone-400'
            : 'text-stone-600'}"
        >
          Try asking:
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          {#each exampleQuestions as example}
            <button
              onclick={() => selectExample(example)}
              class="text-left p-4 rounded-xl border transition-all group {isDark
                ? 'border-stone-700 hover:border-amber-600 hover:bg-amber-950/30'
                : 'border-stone-200 hover:border-amber-300 hover:bg-amber-50/50'}"
            >
              <span
                class={isDark
                  ? "text-stone-300 group-hover:text-stone-100"
                  : "text-stone-700 group-hover:text-stone-900"}
              >
                {example}
              </span>
            </button>
          {/each}
        </div>
      </div>
    {:else}
      <!-- Conversation -->
      <div class="space-y-8 mb-12">
        {#each messages as message (message.id)}
          <div
            class="flex gap-4 {message.role === 'user'
              ? 'justify-end'
              : 'justify-start'}"
          >
            <div
              class="flex gap-4 max-w-4xl {message.role === 'user'
                ? 'flex-row-reverse'
                : 'flex-row'}"
            >
              <!-- Avatar -->
              <div class="shrink-0">
                {#if message.role === "user"}
                  <div
                    class="w-10 h-10 rounded-full bg-stone-600 flex items-center justify-center"
                  >
                    <svg
                      class="w-6 h-6 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                  </div>
                {:else}
                  <div
                    class="w-10 h-10 rounded-full bg-amber-600 flex items-center justify-center"
                  >
                    <svg
                      class="w-6 h-6 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                      />
                    </svg>
                  </div>
                {/if}
              </div>

              <!-- Message Content -->
              <div class="flex-1">
                <div
                  class="px-6 py-4 {message.role === 'user'
                    ? isDark
                      ? 'bg-stone-700 text-white rounded-2xl rounded-tr-sm'
                      : 'bg-stone-700 text-white rounded-2xl rounded-tr-sm'
                    : isDark
                      ? 'bg-stone-800 border border-stone-700 rounded-2xl rounded-tl-sm shadow-sm text-stone-100'
                      : 'bg-white border border-stone-200 rounded-2xl rounded-tl-sm shadow-sm'}"
                >
                  <div
                    class="prose max-w-none {message.role === 'user'
                      ? 'prose-invert'
                      : isDark
                        ? 'prose-invert prose-stone'
                        : 'prose-stone'}"
                  >
                    {#if message.role === "user"}
                      <p class="whitespace-pre-wrap leading-relaxed">
                        {message.content}
                      </p>
                    {:else}
                      {@html renderContent(message.content)}
                    {/if}
                  </div>
                </div>

                <!-- Sources -->
                {#if message.sources && message.sources.length > 0}
                  {@const {
                    usedSources,
                    unusedSources,
                    evidenceMap,
                    citationOrder,
                  } = categorizeSources(message)}
                  <div class="mt-4 space-y-2">
                    <!-- Used Sources Section -->
                    {#if usedSources.length > 0}
                      <p
                        class="text-xs font-semibold uppercase tracking-wider {isDark
                          ? 'text-stone-400'
                          : 'text-stone-600'}"
                      >
                        Evidence Used ({usedSources.length})
                      </p>
                      {#each usedSources as source}
                        {@const evidence = evidenceMap.get(source.id)}
                        {@const safeId = source.id.replace(
                          /[^a-zA-Z0-9-]/g,
                          "_",
                        )}
                        {@const citationNum = citationOrder.get(source.id)}
                        {@const sepUrl = getSEPUrl(source.id)}
                        <div
                          id="source-{safeId}"
                          class="block p-3 rounded-lg border transition-all {isDark
                            ? 'border-amber-700 bg-amber-950/30'
                            : 'border-amber-200 bg-amber-50/50'}"
                        >
                          <div
                            class="flex items-start justify-between gap-3 mb-2"
                          >
                            <div class="flex-1 min-w-0">
                              <div class="flex items-center gap-2">
                                {#if citationNum !== undefined}
                                  <span
                                    class="inline-flex items-center justify-center w-6 h-6 text-xs font-bold rounded {isDark
                                      ? 'bg-amber-700 text-amber-100'
                                      : 'bg-amber-600 text-white'}"
                                  >
                                    {citationNum}
                                  </span>
                                {/if}
                                <h4
                                  class="font-semibold text-sm {isDark
                                    ? 'text-stone-200'
                                    : 'text-stone-900'}"
                                >
                                  {(source.doc_title ?? "").replace(
                                    /\s+\(Stanford Encyclopedia of Philosophy\)$/,
                                    "",
                                  )}
                                </h4>
                              </div>
                              {#if source.section_heading}
                                <p
                                  class="text-xs mt-1 {isDark
                                    ? 'text-stone-400'
                                    : 'text-stone-600'}"
                                >
                                  § {@html parseTeX(source.section_heading)}
                                </p>
                              {/if}
                            </div>
                            {#if sepUrl}
                              <a
                                href={sepUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="shrink-0 p-1.5 rounded transition-colors {isDark
                                  ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-900/30'
                                  : 'text-amber-600 hover:text-amber-700 hover:bg-amber-100'}"
                                title="View on Stanford Encyclopedia of Philosophy"
                              >
                                <svg
                                  class="w-4 h-4"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                                  />
                                </svg>
                              </a>
                            {/if}
                          </div>
                          {#if evidence}
                            <div class="mb-2">
                              <p
                                class="text-xs font-semibold mb-1 {isDark
                                  ? 'text-amber-400'
                                  : 'text-amber-700'}"
                              >
                                Quote:
                              </p>
                              <div
                                class="text-xs italic {isDark
                                  ? 'text-stone-300'
                                  : 'text-stone-700'}"
                              >
                                "{@html parseTeX(evidence.verbatim_quote)}"
                              </div>
                            </div>
                            <!-- <div class="mb-2">
                              <p
                                class="text-xs font-semibold mb-1 {isDark
                                  ? 'text-amber-400'
                                  : 'text-amber-700'}"
                              >
                                Role:
                              </p>
                              <p
                                class="text-xs {isDark
                                  ? 'text-stone-300'
                                  : 'text-stone-700'}"
                              >
                                {evidence.role_in_answer}
                              </p>
                            </div> -->
                          {/if}
                          <p
                            class="text-xs mt-2 font-mono {isDark
                              ? 'text-stone-500'
                              : 'text-stone-500'}"
                          >
                            {source.id}
                          </p>
                        </div>
                      {/each}
                    {/if}

                    <!-- Toggle for Unused Sources -->
                    {#if unusedSources.length > 0}
                      <button
                        onclick={() => toggleUnusedSources(message.id)}
                        class="w-full text-left text-xs font-semibold uppercase tracking-wider flex items-center gap-2 transition-colors py-2 {isDark
                          ? 'text-stone-400 hover:text-stone-300'
                          : 'text-stone-600 hover:text-stone-700'}"
                      >
                        Show unused sources ({unusedSources.length})
                        <svg
                          class="w-4 h-4 transition-transform {showUnusedSources[
                            message.id
                          ]
                            ? 'rotate-180'
                            : ''}"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </button>

                      <!-- Unused Sources (Collapsed by Default) -->
                      {#if showUnusedSources[message.id]}
                        {#each unusedSources as source}
                          {@const safeId = source.id.replace(
                            /[^a-zA-Z0-9-]/g,
                            "_",
                          )}
                          {@const sepUrl = getSEPUrl(source.id)}
                          <div
                            id="source-{safeId}"
                            class="block p-3 rounded-lg border transition-all {isDark
                              ? 'border-stone-700 bg-stone-800/50'
                              : 'border-stone-200 bg-stone-50/50'}"
                          >
                            <div
                              class="flex items-start justify-between gap-3 mb-2"
                            >
                              <div class="flex-1 min-w-0">
                                <h4
                                  class="font-semibold text-sm {isDark
                                    ? 'text-stone-200'
                                    : 'text-stone-900'}"
                                >
                                  {(source.doc_title ?? "").replace(
                                    /\s+\(Stanford Encyclopedia of Philosophy\)$/,
                                    "",
                                  )}
                                </h4>
                                {#if source.section_heading}
                                  <p
                                    class="text-xs mt-1 {isDark
                                      ? 'text-stone-400'
                                      : 'text-stone-600'}"
                                  >
                                    § {@html parseTeX(source.section_heading)}
                                  </p>
                                {/if}
                              </div>
                              {#if sepUrl}
                                <a
                                  href={sepUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  class="shrink-0 p-1.5 rounded transition-colors {isDark
                                    ? 'text-stone-400 hover:text-stone-300 hover:bg-stone-700'
                                    : 'text-stone-600 hover:text-stone-700 hover:bg-stone-100'}"
                                  title="View on Stanford Encyclopedia of Philosophy"
                                >
                                  <svg
                                    class="w-4 h-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                      stroke-width="2"
                                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                                    />
                                  </svg>
                                </a>
                              {/if}
                            </div>
                            <div
                              class="text-xs line-clamp-3 {isDark
                                ? 'text-stone-400'
                                : 'text-stone-600'}"
                            >
                              {@html parseTeX(source.text)}
                            </div>
                            <p
                              class="text-xs mt-2 font-mono {isDark
                                ? 'text-stone-500'
                                : 'text-stone-500'}"
                            >
                              {source.id}
                            </p>
                          </div>
                        {/each}
                      {/if}
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          </div>
        {/each}

        {#if isLoading}
          <div class="flex gap-4">
            <div class="shrink-0">
              <div
                class="w-10 h-10 rounded-full bg-amber-600 flex items-center justify-center"
              >
                <svg
                  class="w-6 h-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
              </div>
            </div>
            <div
              class="rounded-2xl rounded-tl-sm shadow-sm px-6 py-4 {isDark
                ? 'bg-stone-800 border border-stone-700'
                : 'bg-white border border-stone-200'}"
            >
              <div class="flex gap-1">
                <div
                  class="w-2 h-2 rounded-full animate-bounce {isDark
                    ? 'bg-stone-500'
                    : 'bg-stone-400'}"
                  style="animation-delay: 0ms"
                ></div>
                <div
                  class="w-2 h-2 rounded-full animate-bounce {isDark
                    ? 'bg-stone-500'
                    : 'bg-stone-400'}"
                  style="animation-delay: 150ms"
                ></div>
                <div
                  class="w-2 h-2 rounded-full animate-bounce {isDark
                    ? 'bg-stone-500'
                    : 'bg-stone-400'}"
                  style="animation-delay: 300ms"
                ></div>
              </div>
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Input Area -->
    <div class="sticky bottom-6">
      <div
        class="rounded-2xl shadow-lg border p-4 {isDark
          ? 'bg-stone-800 border-stone-700'
          : 'bg-white border-stone-200'}"
      >
        <form
          onsubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          class="flex gap-3"
        >
          <textarea
            bind:this={inputElement}
            bind:value={query}
            onkeydown={handleKeydown}
            placeholder="Ask a philosophical question..."
            rows="1"
            class="flex-1 resize-none rounded-lg px-4 py-3 border focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent font-light {isDark
              ? 'bg-stone-900 border-stone-600 text-stone-100 placeholder:text-stone-500'
              : 'bg-white border-stone-300 text-stone-900 placeholder:text-stone-400'}"
            disabled={isLoading}
          ></textarea>
          <button
            type="submit"
            disabled={!query.trim() || isLoading}
            class="px-6 py-3 bg-amber-600 hover:bg-amber-700 disabled:bg-stone-300 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center gap-2"
          >
            {#if isLoading}
              <svg class="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                ></circle>
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
            {:else}
              <svg
                class="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M14 5l7 7m0 0l-7 7m7-7H3"
                />
              </svg>
            {/if}
          </button>
        </form>
        <p
          class="text-xs mt-3 text-center {isDark
            ? 'text-stone-500'
            : 'text-stone-500'}"
        >
          Press <kbd
            class="px-1.5 py-0.5 rounded border font-mono {isDark
              ? 'bg-stone-900 border-stone-600'
              : 'bg-stone-100 border-stone-300'}">Enter</kbd
          >
          to send,
          <kbd
            class="px-1.5 py-0.5 rounded border font-mono {isDark
              ? 'bg-stone-900 border-stone-600'
              : 'bg-stone-100 border-stone-300'}">Shift+Enter</kbd
          > for new line
        </p>
      </div>
    </div>
  </main>

  <!-- Footer -->
  <footer
    class="border-t backdrop-blur-sm mt-20 {isDark
      ? 'border-stone-800 bg-stone-900/50'
      : 'border-stone-200 bg-white/50'}"
  >
    <div
      class="max-w-5xl mx-auto px-6 py-8 text-center text-sm {isDark
        ? 'text-stone-400'
        : 'text-stone-600'}"
    >
      <p class="mb-2">
        Unofficial tool for the
        <a
          href="https://plato.stanford.edu/"
          target="_blank"
          rel="noopener noreferrer"
          class="font-medium underline {isDark
            ? 'text-amber-400 hover:text-amber-300'
            : 'text-amber-700 hover:text-amber-900'}"
        >
          Stanford Encyclopedia of Philosophy
        </a>
      </p>
      <p class="text-xs {isDark ? 'text-stone-500' : 'text-stone-500'}">
        Not affiliated with Stanford University or the Stanford Encyclopedia of
        Philosophy
      </p>
    </div>
  </footer>
</div>

<style>
  @keyframes bounce {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-0.25rem);
    }
  }

  .animate-bounce {
    animation: bounce 1s infinite;
  }

  /* Enhanced prose styling for markdown content */
  :global(.prose h2) {
    font-weight: 700;
    margin-top: 1.5em;
    margin-bottom: 0.75em;
    font-size: 1.5em;
    line-height: 1.3;
  }

  :global(.prose h3) {
    font-weight: 600;
    margin-top: 1.25em;
    margin-bottom: 0.5em;
    font-size: 1.25em;
  }

  :global(.prose p) {
    margin-top: 0.75em;
    margin-bottom: 0.75em;
    line-height: 1.7;
  }

  :global(.prose code) {
    font-size: 0.875em;
    padding: 0.125em 0.25em;
    border-radius: 0.25em;
    font-family: ui-monospace, monospace;
  }

  :global(.prose pre) {
    margin-top: 1em;
    margin-bottom: 1em;
    padding: 1em;
    border-radius: 0.5em;
    overflow-x: auto;
    font-size: 0.875em;
    line-height: 1.5;
  }

  :global(.prose pre code) {
    padding: 0;
    background-color: transparent;
  }

  :global(.prose ul, .prose ol) {
    margin-top: 0.75em;
    margin-bottom: 0.75em;
    padding-left: 1.5em;
  }

  :global(.prose li) {
    margin-top: 0.25em;
    margin-bottom: 0.25em;
  }

  :global(.prose strong) {
    font-weight: 600;
  }

  :global(.prose a) {
    text-decoration: underline;
    font-weight: 500;
  }

  :global(.prose blockquote) {
    border-left: 3px solid;
    padding-left: 1em;
    font-style: italic;
    margin: 1em 0;
  }

  /* Citation link styling */
  :global(.citation) {
    display: inline-block;
    font-size: 0.75em;
    font-weight: 600;
    color: #d97706;
    background-color: rgba(217, 119, 6, 0.1);
    border: 1px solid rgba(217, 119, 6, 0.3);
    border-radius: 0.25rem;
    padding: 0.1em 0.35em;
    margin: 0 0.15em;
    text-decoration: none;
    vertical-align: super;
    line-height: 1;
    transition: all 0.2s ease;
    cursor: pointer;
  }

  :global(.citation:hover) {
    background-color: rgba(217, 119, 6, 0.2);
    border-color: rgba(217, 119, 6, 0.5);
    transform: translateY(-1px);
  }

  :global(.citation.unsupported) {
    color: #dc2626;
    background-color: rgba(220, 38, 38, 0.1);
    border: 1px solid rgba(220, 38, 38, 0.3);
    cursor: help;
    font-style: italic;
  }

  :global(.citation.unsupported:hover) {
    background-color: rgba(220, 38, 38, 0.2);
    border-color: rgba(220, 38, 38, 0.5);
  }

  /* Highlight effect for scrolled-to sources */
  @keyframes highlight-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(217, 119, 6, 0);
    }
    50% {
      box-shadow: 0 0 0 8px rgba(217, 119, 6, 0.3);
    }
  }

  :global(.highlight-source) {
    animation: highlight-pulse 1s ease-in-out 2;
  }
</style>
