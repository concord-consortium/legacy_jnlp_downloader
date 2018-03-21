Reads a list of activity urls, and creates a JNLP and config file for each activity.

1. Create one .txt file per project in /activities_to_convert/{project-name}.txt, e.g. sam.txt

2. List each activity on a new line. The activities can EITHER be

   a. a DIY portal url, e.g.
         http://ri-itest.portal.concord.org/diy/view/76/type/ExternalOtrunkActivity/

   b. or a url that redirects to a DIY portal url, e.g.
         https://learn.concord.org/eresources/112.run_resource_html

   c. a JNLPWrapper url, e.g.
         http://jnlpwrapper.diy.concord.org/jcl/UDL/udl-plants.jnlp?jnlp=http://static.concord.org/activity-finder/jnlp/udl-plants.jnlp

3. From the command line, run

         yarn
         node create-jnlps.js {project-name} [-otml]

4. JNLP files and configs, and optional OTML files will be written to

         /legacy_jnlp_resources/{project-name}/...

   Each filename will contain the original activity number.
   If the -otml flag is included, the OTML will be downloaded an modified. Note no attempt is made right now
   to parse the OTML for other resources.

5. A CSV file will be created at /results/{project-name}.csv. This file will be in the form:
    Title, Original url, New JNLP wrapper url, Wrapped JNLP url, Referenced config url, Referenced OTML url