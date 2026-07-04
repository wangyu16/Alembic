# User Guide

## Start from small elements

### Assets

You do not need to complete a whole package of a course then share it with other people. You can simply create an illustration figure, a derivation of a formula, an explonation of one concept, .... and save them in 'assets', and share each individual elements so other people can find and use them. 

For example, a clear illustration image of the correlation of several concepts can be much more informative than a long paragraph of text to explain it. However, not everyone is good at creating nice illustration pictures. If you can contribute one and make it discoverable, then other people can insert it to their cource documents. If some one catch a small mistake in it and report it. You can correct it so every one using this picture will get notice to update. Some one may want to do a small revision/expansion to the image, once this person does this revision, everyone will get notice as well. Some users may find the revision better meets their need, so they can decide to adapt. Other users perfer to keep the original version, they can keep it. So the image fork into two versions. 

In this case, any small piece of contribution can be published to let other people to use.

### Private

You may want to create an exam which definitely should not be public, at least before the exam actually takes place. No worries, you can put it in 'private'. 

You may want to create some personal notes regarding your coure, there is no meaning to share publicly. You can put it in 'private'.

You are creating some teaching materials but not finished, there might be erros, there might be license concerns. You can also put them in 'private'.

## Finish as a whole package

A complete package of a whole course should include: 

- Course Concept Map: (.md basic markdown file can be rendered with any markdown parser) a course level concept map showing the main topics and concepts, and objectives, in the course and their correlations. Not designed for public facing, but publicly availalbe in Github repository. When an educator adapt a whole course this file will be included. 
- For each chapter, there should be following:
	1. Chapter Concept Map: (.md basic markdown file can be rendered with any markdown parser) a chapter level concept map showing the main topics and concepts, and objectives, in the course and their correlations. Not designed for public facing but included for adaption. 
    2. Study Guide: (.md.html file with rich orz-markdown formating) A complete description of course topics/concepts, learning objectives, with graphic illustrations, tables, examples, ... with well organized layout. For a course with textbook, this study guide is a concise page showing everything important. For a course without textook, this study guide serve as a textbook with all details. The name study guide is not manditory, some may want to call it lecture note, handout, or what ever. It should include 'everything', serve as the source of truth of the course. Public facing. 
    3. Slides: (.slides.html file) A slide deck derived from the study guide. Include essentially the same outline and all topics/concepts with more concise description (bullet points when possible) and graphic elements, tables from study guide. Public facing. 
    4. Assessment Guide: (.md file) How to assess each topic, concept, what kind of questions should be asked, how the questions should be asked, differentiation for assignments, discussion, quiz, exam, ..., several example question ideas per learning objective. (not a question pool, but methods how to provide assessment questions). Not public facing. 
    5. Example and Practice Questions: (.md.html file) A list of example and practice questions created according to the assessment guide to give students ideas what kind of questions will be expected for practices, assignments, quiz/exams, .... Public facing.
    6. Assets: (not a file but a space for all kinds of files) Any individual piece of element can be added here. Such as an image, chemical reaction scheme, plot, diagram, markdown source of a description of a key concept, a pdf/word/pptx file, .... essentially whatever can be stored in Github and want to be shared. Each individual file can be searched and adapted. 
    7. Current: (not a file but a space for all kinds of files) Anything used for current teaching cycle can be saved here, such as assignment list for this semester; completed exams with keys for students to review; .... when a new semester starts, the old one will be archived. Only the newest set will be shown on the course website. When adapted this will not be included automatically. Prefer to use .paged.html for exam sheets, handouts, ...
    7. Private: (not a file but a space for all kinds of files) Anything confidential such as exam questions with keys. Or personal notes no meaning to share. Or incomplete elements that are not ready to share. Files here are in private Github repository, no public link, not discoverable. cannot be discovered or adapted by other people. Prefer to use .paged.html for exam sheets, handouts, ...
    
Course website: Each course is a static website served on GitHub pages. Need an index page to organize all public facing resources. Study guide as the center, other elements also need to be each to find, intuitive to see. current semester elements can be included or excluded per instructor's decision. 

Workspace: 
- provide metadata editing and document organization
- for basic .md files provide a simple text editor which can be switch to rendered view
- for .md.html, .slides.html, .paged.html files provide the interface to edit/view and save back to github repository. they have built-in editors that can be used directly. 
- keep it possible to register new editors for specific type of documents, such as what '.ketcher.svg' does. this mechanism can be expanded for other type of files. 
- Assets, current and private are file spaces, need to provide a file organization interface. 